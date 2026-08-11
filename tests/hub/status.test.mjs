import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — status writes');
const FIX = join(ROOT, 'tests/hub/fixtures');
const CALLS = join(FIX, '.status-calls');
const { createServer, route } = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);
const { cookieValue } = await import(pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href);

await rm(CALLS, { force: true });

const srv = createServer({ root: FIX, token: 'test-token' });
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

async function request(payload) {
  const body = JSON.stringify(payload);
  if (base) return fetch(`${base}/api/status`, { method: 'POST', headers, body });

  const url = new URL('/api/status', 'http://hub.local');
  const entry = route({ root: FIX, token: 'test-token' }).find(candidate =>
    candidate.method === 'POST' && candidate.pattern === url.pathname);
  const chunks = [];
  const response = {
    status: 200,
    headersSent: false,
    writeHead(status) { this.status = status; this.headersSent = true; },
    end(chunk = '') { chunks.push(Buffer.from(chunk)); },
  };
  const req = Readable.from([Buffer.from(body)]);
  req.headers = headers;
  await entry.handler(req, response, url);
  const responseBody = Buffer.concat(chunks).toString('utf8');
  return {
    status: response.status,
    text: async () => responseBody,
    json: async () => JSON.parse(responseBody),
  };
}

try {
  let response = await request({ num: 2, state: 'Responded' });
  let data = await response.json();
  let calls = await readFile(CALLS, 'utf8');
  if (response.status === 200 && data.ok === true && calls === '2 Responded\n') {
    pass('valid status update runs set-status stub');
  } else fail(`valid status=${response.status} data=${JSON.stringify(data)} calls=${JSON.stringify(calls)}`);

  response = await request({ num: 2, state: 'Nope' });
  data = await response.json();
  if (response.status === 422 && data.ok === false && data.stderr.includes('bad state')) {
    pass('invalid status returns stderr');
  } else fail(`invalid status=${response.status} data=${JSON.stringify(data)}`);

  response = await request({});
  data = await response.json();
  if (response.status === 400 && data.ok === false && data.error === 'missing fields') {
    pass('missing fields return 400');
  } else fail(`missing status=${response.status} data=${JSON.stringify(data)}`);

  const before = (await readFile(CALLS, 'utf8')).trimEnd().split('\n').length;
  const responses = await Promise.all(Array.from({ length: 5 }, () =>
    request({ num: 2, state: 'Applied' })));
  calls = await readFile(CALLS, 'utf8');
  const lines = calls.trimEnd().split('\n');
  const added = lines.slice(before);
  if (responses.every(item => item.status === 200)
    && added.length === 5 && added.every(line => line === '2 Applied')) {
    pass('parallel status updates are serialized');
  } else fail(`parallel statuses=${responses.map(item => item.status)} calls=${JSON.stringify(lines)}`);
} finally {
  if (base) await new Promise(resolve => srv.close(resolve));
}
