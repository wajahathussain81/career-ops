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
if (JSON.stringify(codexArgv) === JSON.stringify(['codex', 'exec', '--json', 'x'])
  && JSON.stringify(claudeArgv) === JSON.stringify([
    'claude', '-p', '--output-format', 'stream-json', '--verbose', 'x',
  ])
  && PREAMBLE.includes('never submit/send/apply')) {
  pass('buildArgv creates codex and claude argv shapes');
} else fail(`argv codex=${JSON.stringify(codexArgv)} claude=${JSON.stringify(claudeArgv)}`);

function runWorker(options) {
  return new Promise((resolve, reject) => {
    const events = [];
    try {
      startRun({
        root: ROOT,
        prompt: options.prompt || 'test prompt',
        worker: options.worker || 'codex',
        workerCmd: options.workerCmd,
        logDir: options.logDir || logDir,
        onEvent: event => { events.push(event); },
        onExit: code => resolve({ code, events }),
      });
    } catch (error) {
      reject(error);
    }
  });
}

const successful = await runWorker({
  worker: 'claude',
  workerCmd: [
    process.execPath,
    '-e',
    `const line = text => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    process.stdout.write(line('line one') + '\\n');
    setTimeout(() => process.stdout.write(line('line two') + '\\n'), 10);`,
  ],
});
if (successful.code === 0 && JSON.stringify(successful.events) === JSON.stringify([
  { kind: 'message', text: 'line one' },
  { kind: 'message', text: 'line two' },
])) {
  pass('startRun streams normalized Claude events and exits zero');
} else fail(`successful run=${JSON.stringify(successful)}`);

const originalHubToken = process.env.HUB_TOKEN;
const originalCookieSecure = process.env.HUB_COOKIE_SECURE;
process.env.HUB_TOKEN = 'secret-that-must-not-reach-worker';
process.env.HUB_COOKIE_SECURE = 'true';
const envResult = await runWorker({
  worker: 'claude',
  workerCmd: [
    process.execPath,
    '-e',
    `const text = \`token=\${process.env.HUB_TOKEN};cookie=\${process.env.HUB_COOKIE_SECURE};path=\${Boolean(process.env.PATH)}\`;
    console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));`,
  ],
});
if (originalHubToken === undefined) delete process.env.HUB_TOKEN;
else process.env.HUB_TOKEN = originalHubToken;
if (originalCookieSecure === undefined) delete process.env.HUB_COOKIE_SECURE;
else process.env.HUB_COOKIE_SECURE = originalCookieSecure;
if (envResult.code === 0
  && !JSON.stringify(envResult.events).includes('secret-that-must-not-reach-worker')
  && envResult.events[0]?.text === 'token=undefined;cookie=undefined;path=true') {
  pass('startRun strips hub credentials while retaining the worker environment');
} else fail(`worker env=${JSON.stringify(envResult)}`);

const maxOutputBytes = 256 * 1024;
const boundedLogDir = join(tempRoot, 'bounded-logs');
const bounded = await runWorker({
  worker: 'claude',
  workerCmd: [
    process.execPath,
    '-e',
    `const text = 'x'.repeat(${maxOutputBytes + 8192});
    process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) + '\\n')`,
  ],
  logDir: boundedLogDir,
});
const boundedFiles = await readdir(boundedLogDir);
const boundedTranscript = await readFile(join(boundedLogDir, boundedFiles[0]), 'utf8');
const boundedOutput = boundedTranscript.slice(boundedTranscript.indexOf('---\n') + 4);
const truncationMarker = '…[output truncated]…\n';
if (bounded.code === 0 && bounded.events[0]?.text.length > maxOutputBytes
  && boundedOutput.length <= maxOutputBytes + truncationMarker.length + 1
  && boundedOutput.startsWith(truncationMarker)) {
  pass('startRun streams full events live but bounds retained transcript output');
} else {
  fail(`bounded live=${bounded.events[0]?.text.length} retained=${boundedOutput.length} marker=${boundedOutput.startsWith(truncationMarker)}`);
}

const codexLogDir = join(tempRoot, 'codex-logs');
const codexJsonl = await runWorker({
  logDir: codexLogDir,
  workerCmd: [
    process.execPath,
    '-e',
    `const events = [
      'Codex CLI banner',
      JSON.stringify({ type: 'thread.started', thread_id: 'thread_1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'hidden reasoning' } }),
      JSON.stringify({ type: 'item.completed', item: { id: 'msg_0', type: 'agent_message', text: 'Visible answer' } }),
      JSON.stringify({ type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'echo hello'", status: 'in_progress' } }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'ignored completed label', aggregated_output: 'hello\\n', exit_code: 0, status: 'completed' } }),
      JSON.stringify({ type: 'item.started', item: { id: 'item_2', type: 'file_change', changes: [{ path: '/abs/path/probe.txt', kind: 'add' }], status: 'in_progress' } }),
      JSON.stringify({ type: 'item.failed', item: { id: 'item_2', type: 'file_change', changes: [{ path: '/abs/path/probe.txt', kind: 'add' }], status: 'failed' } }),
      JSON.stringify({ type: 'item.started', item: { id: 'item_3', type: 'web_search', query: 'agent consoles', status: 'in_progress' } }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_3', type: 'web_search', query: 'agent consoles', status: 'completed' } }),
      JSON.stringify({ type: 'item.started', item: { id: 'item_4', type: 'mcp_tool_call', server: 'github', tool: 'create_issue', status: 'in_progress' } }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_4', type: 'mcp_tool_call', server: 'github', tool: 'create_issue', status: 'completed' } }),
      JSON.stringify({ type: 'error', message: 'worker failed' }),
      JSON.stringify({ type: 'turn.completed', usage: {
        input_tokens: 48152, cached_input_tokens: 33024, output_tokens: 305,
      } }),
    ];
    process.stdout.write(events.slice(0, 3).join('\\n') + '\\n');
    const message = events.slice(3).join('\\n');
    process.stdout.write(message.slice(0, 37));
    setTimeout(() => process.stdout.write(message.slice(37)), 10);
    process.stderr.write('warning: hidden banner\\n');`,
  ],
});
const expectedCodexEvents = [
  { kind: 'status', text: 'thinking…' },
  { kind: 'message', text: 'Visible answer' },
  { kind: 'action', phase: 'start', id: 'item_1', icon: 'command', label: 'echo hello' },
  { kind: 'action', phase: 'end', id: 'item_1', icon: 'command', label: 'echo hello', ok: true },
  { kind: 'action', phase: 'start', id: 'item_2', icon: 'file', label: 'add probe.txt' },
  { kind: 'action', phase: 'end', id: 'item_2', icon: 'file', label: 'add probe.txt', ok: false },
  { kind: 'action', phase: 'start', id: 'item_3', icon: 'search', label: 'agent consoles' },
  { kind: 'action', phase: 'end', id: 'item_3', icon: 'search', label: 'agent consoles', ok: true },
  { kind: 'action', phase: 'start', id: 'item_4', icon: 'tool', label: 'github create_issue' },
  { kind: 'action', phase: 'end', id: 'item_4', icon: 'tool', label: 'github create_issue', ok: true },
  { kind: 'error', text: 'worker failed' },
  { kind: 'usage', inputTokens: 48152, outputTokens: 305 },
];
if (codexJsonl.code === 0
  && JSON.stringify(codexJsonl.events) === JSON.stringify(expectedCodexEvents)) {
  pass('codex JSONL maps messages, actions, status, errors, and usage exactly');
} else fail(`codex JSONL events=${JSON.stringify(codexJsonl)}`);

const codexTranscriptFile = (await readdir(codexLogDir))[0];
const codexTranscript = await readFile(join(codexLogDir, codexTranscriptFile), 'utf8');
const codexTranscriptOutput = codexTranscript.slice(codexTranscript.indexOf('---\n') + 4);
const expectedTranscriptOutput = `Visible answer
$ echo hello … ok
$ add probe.txt … failed
$ agent consoles … ok
$ github create_issue … ok
! worker failed
`;
if (codexTranscriptOutput === expectedTranscriptOutput) {
  pass('transcript renders normalized output without live-only usage events');
} else fail(`codex transcript=${JSON.stringify(codexTranscriptOutput)}`);

const codexZeroStderr = await runWorker({
  workerCmd: [process.execPath, '-e', "process.stderr.write('discard me\\n')"],
});
if (codexZeroStderr.code === 0 && codexZeroStderr.events.length === 0) {
  pass('codex discards stderr on successful exit');
} else fail(`codex zero stderr=${JSON.stringify(codexZeroStderr)}`);

const codexErrorEvent = await runWorker({
  workerCmd: [
    process.execPath,
    '-e',
    `process.stdout.write(JSON.stringify({ type: 'error', message: 'worker failed' }))`,
  ],
});
if (codexErrorEvent.code === 0 && JSON.stringify(codexErrorEvent.events) === JSON.stringify([
  { kind: 'error', text: 'worker failed' },
])) {
  pass('codex JSONL surfaces top-level error events');
} else fail(`codex error event=${JSON.stringify(codexErrorEvent)}`);

const claudeJsonl = await runWorker({
  worker: 'claude',
  workerCmd: [
    process.execPath,
    '-e',
    `const events = [
      'Claude CLI banner',
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'thinking', thinking: 'private' },
        { type: 'text', text: 'Claude answer' },
        { type: 'tool_use', id: 'tool_1', name: 'Bash', input: { command: 'node --check hub/server.mjs' } },
        { type: 'tool_use', id: 'tool_2', name: 'Read', input: { file_path: '/abs/path/agent.mjs' } },
        { type: 'tool_use', id: 'tool_3', name: 'TodoWrite', input: {} },
      ] } }),
      JSON.stringify({ type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'tool_1', is_error: false },
        { type: 'tool_result', tool_use_id: 'tool_2', is_error: true },
        { type: 'tool_result', tool_use_id: 'tool_3' },
      ] } }),
      JSON.stringify({ type: 'rate_limit_event', rate_limit_info: {} }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'already streamed',
        usage: { input_tokens: 927, output_tokens: 118 } }),
      JSON.stringify({ type: 'result', subtype: 'error_during_execution', message: 'quota exhausted' }),
    ];
    process.stdout.write(events.slice(0, 4).join('\\n') + '\\n');
    const tail = events.slice(4).join('\\n');
    process.stdout.write(tail.slice(0, 23));
    setTimeout(() => process.stdout.write(tail.slice(23)), 10);
    process.stderr.write('successful warning is hidden\\n');`,
  ],
});
const expectedClaudeEvents = [
  { kind: 'status', text: 'thinking…' },
  { kind: 'message', text: 'Claude answer' },
  { kind: 'action', phase: 'start', id: 'tool_1', icon: 'command', label: 'node --check hub/server.mjs' },
  { kind: 'action', phase: 'start', id: 'tool_2', icon: 'file', label: 'Read agent.mjs' },
  { kind: 'action', phase: 'start', id: 'tool_3', icon: 'tool', label: 'TodoWrite' },
  { kind: 'action', phase: 'end', id: 'tool_1', icon: 'command', label: 'node --check hub/server.mjs', ok: true },
  { kind: 'action', phase: 'end', id: 'tool_2', icon: 'file', label: 'Read agent.mjs', ok: false },
  { kind: 'action', phase: 'end', id: 'tool_3', icon: 'tool', label: 'TodoWrite', ok: true },
  { kind: 'usage', inputTokens: 927, outputTokens: 118 },
  { kind: 'error', text: 'quota exhausted' },
];
if (claudeJsonl.code === 0
  && JSON.stringify(claudeJsonl.events) === JSON.stringify(expectedClaudeEvents)) {
  pass('claude stream-json maps content blocks, tool results, and usage exactly');
} else fail(`claude JSONL events=${JSON.stringify(claudeJsonl)}`);

const scheduledTimers = [];
const killSignals = [];
let killRun;
const killExit = new Promise(resolve => {
  killRun = startRun({
    root: ROOT,
    prompt: 'kill escalation test',
    worker: 'codex',
    workerCmd: [process.execPath, '-e', 'setTimeout(() => {}, 100)'],
    logDir,
    onExit: resolve,
    setTimer(callback, delay) {
      const handle = { callback, delay, cleared: false, unref() {} };
      scheduledTimers.push(handle);
      return handle;
    },
    clearTimer(handle) {
      handle.cleared = true;
    },
    killProcess(_pid, signal) {
      killSignals.push(signal);
    },
  });
});
killRun.kill();
const escalationTimer = scheduledTimers.find(handle => handle.delay === 5000);
escalationTimer?.callback();
await killExit;
if (JSON.stringify(killSignals) === JSON.stringify(['SIGTERM', 'SIGKILL'])
  && escalationTimer?.cleared) {
  pass('kill schedules deterministic SIGKILL escalation and clears it on close');
} else {
  fail(`kill signals=${JSON.stringify(killSignals)} timers=${JSON.stringify(scheduledTimers.map(({ delay, cleared }) => ({ delay, cleared })))}`);
}

let stdinWaitRun;
let stdinWaitTimer;
const stdinWaitExit = new Promise(resolve => {
  stdinWaitRun = startRun({
    root: ROOT,
    prompt: 'stdin EOF test',
    worker: 'claude',
    workerCmd: [process.execPath, FAKE_WORKER, 'stdin-wait'],
    logDir,
    onEvent() {},
    onExit: code => resolve({ code }),
  });
});
const stdinWaitResult = await Promise.race([
  stdinWaitExit,
  new Promise(resolve => {
    stdinWaitTimer = setTimeout(() => resolve(null), 5000);
  }),
]);
if (stdinWaitResult?.code === 0) {
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
    onEvent() {},
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
    onEvent() {},
    onExit() {},
  });
} catch (error) {
  busyError = error;
}
if (busyError?.message === 'busy') pass('concurrent startRun throws busy');
else fail(`concurrent error=${busyError?.message || 'none'}`);
await busyRun;

const failingLogDir = join(tempRoot, 'failing-logs');
const failing = await runWorker({
  workerCmd: [process.execPath, FAKE_WORKER, 'fail'],
  logDir: failingLogDir,
});
const failingTranscriptFile = (await readdir(failingLogDir))[0];
const failingTranscript = await readFile(join(failingLogDir, failingTranscriptFile), 'utf8');
const failingTranscriptOutput = failingTranscript.slice(failingTranscript.indexOf('---\n') + 4);
if (failing.code === 3 && JSON.stringify(failing.events) === JSON.stringify([
  { kind: 'error', text: 'boom\n' },
]) && failingTranscriptOutput === '! boom\n') {
  pass('startRun buffers stderr and emits it only on non-zero exit');
} else fail(`failing run=${JSON.stringify(failing)}`);

const stderrTail = await runWorker({
  workerCmd: [
    process.execPath,
    '-e',
    `process.stderr.write('discard'.repeat(4096) + 'T'.repeat(16 * 1024)); process.exitCode = 4;`,
  ],
});
if (stderrTail.code === 4 && stderrTail.events.length === 1
  && stderrTail.events[0].kind === 'error'
  && stderrTail.events[0].text === 'T'.repeat(16 * 1024)) {
  pass('startRun surfaces only the 16 KiB stderr tail on failure');
} else fail(`stderr tail=${JSON.stringify(stderrTail.events)}`);

const token = 'test-token';
const workerCmd = [
  process.execPath,
  '-e',
  `process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'line one' } }) + '\\n');
  setTimeout(() => process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'line two' } }) + '\\n'), 100);`,
];
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

async function invokeAppPost(app, pathname, payload) {
  const url = new URL(pathname, 'http://hub.local');
  const entry = route(app).find(candidate =>
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
    json: () => JSON.parse(body),
  };
}

let resolveLockChatExit;
const lockChatExit = new Promise(resolve => { resolveLockChatExit = resolve; });
const lockApp = {
  root: FIX,
  token,
  workerCmd: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
  logDir,
  eventClients: new Set(),
  broadcast(event) {
    if (event === 'chat-exit') resolveLockChatExit();
  },
  chatBusy: false,
  chatRun: null,
};
const lockChatResponse = await invokeAppPost(lockApp, '/api/chat', {
  prompt: 'long-running chat',
  worker: 'codex',
});
const statusDuringChat = invokeAppPost(lockApp, '/api/status', {
  num: 2,
  state: 'Applied',
});
let statusWaitTimer;
const statusFinishedWhileChatRuns = await Promise.race([
  statusDuringChat.then(() => true),
  new Promise(resolve => {
    statusWaitTimer = setTimeout(() => resolve(false), 750);
    statusWaitTimer.unref();
  }),
]);
clearTimeout(statusWaitTimer);
lockApp.chatRun?.kill();
const statusDuringChatResponse = await statusDuringChat;
await lockChatExit;
if (lockChatResponse.status === 202 && statusFinishedWhileChatRuns
  && statusDuringChatResponse.status === 200) {
  pass('running chat does not block status updates on the shared mutex');
} else {
  fail(`chat/status lock chat=${lockChatResponse.status} status=${statusDuringChatResponse.status} concurrent=${statusFinishedWhileChatRuns}`);
}

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
    && frames.includes('data: {"kind":"message","text":"line one"}')
    && !frames.includes('"chunk"') && frames.includes('event: chat-exit\n')) {
    pass(`HTTP chat returns 202 and SSE streams typed chat/chat-exit events${base ? '' : ' (in-memory fallback)'}`);
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
