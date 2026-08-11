import { EventEmitter } from 'node:events';
import { readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { mkdtemp } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — agent console');
const FIX = join(ROOT, 'tests/hub/fixtures');
const FAKE_WORKER = join(FIX, 'fake-worker.mjs');
const tempRoot = await mkdtemp(join(tmpdir(), 'career-ops-agent-'));
const logDir = join(tempRoot, 'hub-logs');
const { PREAMBLE, buildArgv, startRun } = await import(
  pathToFileURL(join(ROOT, 'hub/lib/agent.mjs')).href
);
const { createServer, route } = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);
const { cookieValue } = await import(pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href);

const codexArgv = buildArgv('codex', 'x');
const claudeArgv = buildArgv('claude', 'x');
if (JSON.stringify(codexArgv) === JSON.stringify(['codex', 'exec', 'x'])
  && JSON.stringify(claudeArgv) === JSON.stringify(['claude', '-p', 'x'])
  && PREAMBLE.includes('never submit/send/apply')) {
  pass('buildArgv creates codex and claude argv shapes');
} else fail(`argv codex=${JSON.stringify(codexArgv)} claude=${JSON.stringify(claudeArgv)}`);

function runWorker(options) {
  return new Promise((resolve, reject) => {
    let output = '';
    try {
      startRun({
        root: ROOT,
        prompt: options.prompt || 'test prompt',
        worker: 'codex',
        workerCmd: options.workerCmd,
        logDir,
        onChunk: chunk => { output += chunk; },
        onExit: code => resolve({ code, output }),
      });
    } catch (error) {
      reject(error);
    }
  });
}

const successful = await runWorker({ workerCmd: [process.execPath, FAKE_WORKER] });
if (successful.code === 0 && successful.output.includes('line one')
  && successful.output.includes('line two')) {
  pass('startRun streams stdout and exits zero');
} else fail(`successful run=${JSON.stringify(successful)}`);

let stdinWaitRun;
let stdinWaitTimer;
const stdinWaitExit = new Promise(resolve => {
  let output = '';
  stdinWaitRun = startRun({
    root: ROOT,
    prompt: 'stdin EOF test',
    worker: 'codex',
    workerCmd: [process.execPath, FAKE_WORKER, 'stdin-wait'],
    logDir,
    onChunk: chunk => { output += chunk; },
    onExit: code => resolve({ code, output }),
  });
});
const stdinWaitResult = await Promise.race([
  stdinWaitExit,
  new Promise(resolve => {
    stdinWaitTimer = setTimeout(() => resolve(null), 5000);
  }),
]);
if (stdinWaitResult?.code === 0 && stdinWaitResult.output.includes('stdin done')) {
  clearTimeout(stdinWaitTimer);
  pass('startRun closes worker stdin so stdin consumers exit');
} else {
  fail('startRun stdin consumer did not exit within 5 seconds');
  stdinWaitRun.kill();
  await stdinWaitExit;
}

const busyRun = new Promise(resolve => {
  startRun({
    root: ROOT,
    prompt: 'busy test',
    worker: 'codex',
    workerCmd: [process.execPath, FAKE_WORKER],
    logDir,
    onChunk() {},
    onExit: resolve,
  });
});
let busyError;
try {
  startRun({
    root: ROOT,
    prompt: 'second run',
    worker: 'codex',
    workerCmd: [process.execPath, FAKE_WORKER],
    logDir,
    onChunk() {},
    onExit() {},
  });
} catch (error) {
  busyError = error;
}
if (busyError?.message === 'busy') pass('concurrent startRun throws busy');
else fail(`concurrent error=${busyError?.message || 'none'}`);
await busyRun;

const failing = await runWorker({ workerCmd: [process.execPath, FAKE_WORKER, 'fail'] });
if (failing.code === 3 && failing.output.includes('boom')) {
  pass('startRun captures stderr and non-zero exit');
} else fail(`failing run=${JSON.stringify(failing)}`);

const token = 'test-token';
const workerCmd = [process.execPath, FAKE_WORKER];
const srv = createServer({ root: FIX, token, workerCmd, logDir, watch: false });
let base = null;
try {
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${srv.address().port}`;
} catch (error) {
  if (error?.code !== 'EPERM') throw error;
}

const headers = {
  cookie: `hub=${cookieValue(token)}`,
  'content-type': 'application/json',
};
let fallbackApp;
let fallbackEvents;
if (!base) {
  const eventClients = new Set();
  const broadcast = (event, data) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of eventClients) client.write(frame);
  };
  fallbackApp = { root: FIX, token, workerCmd, logDir, eventClients, broadcast };
  const eventsEntry = route(fallbackApp).find(entry =>
    entry.method === 'GET' && entry.pattern === '/api/events');
  const response = new EventEmitter();
  response.destroyed = false;
  response.frames = '';
  response.writeHead = () => {};
  response.flushHeaders = () => {};
  response.write = chunk => { response.frames += chunk; return true; };
  eventsEntry.handler({}, response, new URL('/api/events', 'http://hub.local'));
  fallbackEvents = response;
}

async function post(pathname, payload) {
  if (base) {
    return fetch(`${base}${pathname}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }

  const url = new URL(pathname, 'http://hub.local');
  const entry = route(fallbackApp).find(candidate =>
    candidate.method === 'POST' && candidate.pattern === url.pathname);
  const chunks = [];
  const response = {
    status: 200,
    headersSent: false,
    writeHead(status) { this.status = status; this.headersSent = true; },
    end(chunk = '') { chunks.push(Buffer.from(chunk)); },
  };
  const req = Readable.from([Buffer.from(JSON.stringify(payload))]);
  req.headers = headers;
  await entry.handler(req, response, url);
  const body = Buffer.concat(chunks).toString('utf8');
  return {
    status: response.status,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

let abortEvents;
let eventFrames;
if (base) {
  abortEvents = new AbortController();
  const response = await fetch(`${base}/api/events`, {
    headers,
    signal: abortEvents.signal,
  });
  const reader = response.body.getReader();
  eventFrames = (async () => {
    let frames = '';
    while (!frames.includes('event: chat-exit')) {
      const { done, value } = await reader.read();
      if (done) break;
      frames += Buffer.from(value).toString('utf8');
    }
    return frames;
  })();
}

try {
  const first = await post('/api/chat', { prompt: 'hello', worker: 'codex' });
  const second = await post('/api/chat', { prompt: 'again', worker: 'codex' });
  const secondBody = await second.json();
  const frames = base
    ? await eventFrames
    : await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('SSE timeout')), 2000);
      const poll = () => {
        if (fallbackEvents.frames.includes('event: chat-exit')) {
          clearTimeout(deadline);
          resolve(fallbackEvents.frames);
        } else setTimeout(poll, 10).unref();
      };
      poll();
    });

  if (first.status === 202 && frames.includes('event: chat\n')
    && frames.includes('line one') && frames.includes('event: chat-exit\n')) {
    pass(`HTTP chat returns 202 and SSE streams chat/chat-exit${base ? '' : ' (in-memory fallback)'}`);
  } else fail(`chat status=${first.status} frames=${JSON.stringify(frames)}`);

  if (second.status === 409 && secondBody.error === 'busy') {
    pass('second HTTP chat request returns 409 while active');
  } else fail(`second chat status=${second.status} body=${JSON.stringify(secondBody)}`);

  const files = await readdir(logDir);
  const transcript = files.find(file => /^\d{4}-\d{2}-\d{2}\.md$/.test(file));
  const contents = transcript ? await readFile(join(logDir, transcript), 'utf8') : '';
  if (transcript && contents.includes('## ') && contents.includes('hello')
    && contents.includes('line one')) {
    pass('chat transcript is appended in injected log directory');
  } else fail(`transcript=${transcript || 'missing'} contents=${JSON.stringify(contents)}`);
} finally {
  abortEvents?.abort();
  fallbackEvents?.emit('close');
  if (base) await new Promise(resolve => srv.close(resolve));
  else srv.close();
  await rm(tempRoot, { recursive: true, force: true });
}
