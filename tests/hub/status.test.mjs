import { cp, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — status writes');
const FIXTURE = join(ROOT, 'tests/hub/fixtures');
const FIX = await mkdtemp(join(tmpdir(), 'career-ops-hub-status-'));
await cp(FIXTURE, FIX, { recursive: true });
await writeFile(join(FIX, 'set-status.mjs'), `import { appendFile } from 'node:fs/promises';

await new Promise(resolve => setTimeout(resolve, 50));
const args = process.argv.slice(2);
const rowIndex = args.indexOf('--row');
const state = args[rowIndex + 2];
if (state === 'Nope') {
  console.error('bad state');
  process.exitCode = 3;
} else {
  await appendFile(new URL('.status-calls', import.meta.url), args.join(' ') + '\\n');
}
`);
const CALLS = join(FIX, '.status-calls');
const { createServer, route } = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);
const { cookieValue } = await import(pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href);

await rm(CALLS, { force: true });

const srv = createServer({ root: FIX, token: 'test-token', watch: false });
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
  cookie: `hub=${cookieValue('test-token')}`,
  'content-type': 'application/json',
};

async function request(payload, { origin, contentType = 'application/json', rawBody } = {}) {
  const body = rawBody ?? JSON.stringify(payload);
  const requestHeaders = { ...headers, 'content-type': contentType };
  if (origin) requestHeaders.origin = origin;
  if (base) return fetch(`${base}/api/status`, { method: 'POST', headers: requestHeaders, body });

  const url = new URL('/api/status', 'http://hub.local');
  const entry = route({ root: FIX, token: 'test-token' }).find(candidate =>
    candidate.method === 'POST' && candidate.pattern === url.pathname);
  const chunks = [];
  const response = {
    status: 200,
    headersSent: false,
    headers: new Headers(),
    writeHead(status, responseHeaders = {}) {
      this.status = status;
      this.headersSent = true;
      for (const [name, value] of Object.entries(responseHeaders)) this.headers.set(name, value);
    },
    end(chunk = '') { chunks.push(Buffer.from(chunk)); },
  };
  const req = Readable.from([Buffer.from(body)]);
  req.headers = { ...requestHeaders, host: 'hub.local' };
  await entry.handler(req, response, url);
  const responseBody = Buffer.concat(chunks).toString('utf8');
  return {
    status: response.status,
    headers: response.headers,
    text: async () => responseBody,
    json: async () => JSON.parse(responseBody),
  };
}

try {
  let response = await request({ num: 2, state: 'Responded' });
  let data = await response.json();
  let calls = await readFile(CALLS, 'utf8');
  if (response.status === 200 && data.ok === true && calls === '--row 2 Responded\n') {
    pass('valid status update uses the explicit tracker-row selector');
  } else fail(`valid status=${response.status} data=${JSON.stringify(data)} calls=${JSON.stringify(calls)}`);

  response = await request({ num: 2, state: 'Nope' });
  data = await response.json();
  if (response.status === 422 && data.ok === false && data.stderr.includes('bad state')) {
    pass('invalid status returns stderr');
  } else fail(`invalid status=${response.status} data=${JSON.stringify(data)}`);

  response = await request({});
  data = await response.json();
  if (response.status === 400 && data.ok === false && data.error === 'missing fields'
    && response.headers?.get('cache-control') === 'private, no-store') {
    pass('missing fields return a private no-store 400 response');
  } else {
    fail(`missing status=${response.status} data=${JSON.stringify(data)} cache-control=${response.headers?.get('cache-control')}`);
  }

  response = await request(
    { num: 2, state: 'Applied' },
    { origin: 'http://evil.example' },
  );
  data = await response.json();
  if (response.status === 403 && data.ok === false && data.error === 'bad origin') {
    pass('cross-origin status mutation is rejected');
  } else fail(`bad origin status=${response.status} data=${JSON.stringify(data)}`);

  response = await request(
    { num: 2, state: 'Applied' },
    { contentType: 'text/plain' },
  );
  data = await response.json();
  if (response.status === 415 && data.ok === false && data.error === 'unsupported content type') {
    pass('non-JSON status mutation is rejected');
  } else fail(`content type status=${response.status} data=${JSON.stringify(data)}`);

  response = await request(null, { rawBody: '{bad json' });
  const malformedText = await response.text();
  try {
    data = JSON.parse(malformedText);
  } catch {
    data = null;
  }
  if (response.status === 400 && data?.ok === false && data.error === 'invalid json') {
    pass('malformed status JSON returns a JSON 400 response');
  } else fail(`malformed JSON status=${response.status} body=${JSON.stringify(malformedText)}`);

  const before = (await readFile(CALLS, 'utf8')).trimEnd().split('\n').length;
  const responses = await Promise.all(Array.from({ length: 5 }, () =>
    request({ num: 2, state: 'Applied' })));
  calls = await readFile(CALLS, 'utf8');
  const lines = calls.trimEnd().split('\n');
  const added = lines.slice(before);
  if (responses.every(item => item.status === 200)
    && added.length === 5 && added.every(line => line === '--row 2 Applied')) {
    pass('parallel status updates are serialized');
  } else fail(`parallel statuses=${responses.map(item => item.status)} calls=${JSON.stringify(lines)}`);
} finally {
  if (base) await new Promise(resolve => srv.close(resolve));
  await rm(FIX, { recursive: true, force: true });
}
