import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — applications');
const FIX = join(ROOT, 'tests/hub/fixtures');
const { mdToHtml } = await import(pathToFileURL(join(ROOT, 'hub/lib/md.mjs')).href);
const { createServer, route } = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);
const { cookieValue } = await import(pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href);

const rendered = mdToHtml('# T\n**b** and [l](http://x)');
if (rendered.includes('<h1>') && rendered.includes('<strong>')
  && rendered.includes('<a href="http://x"')) pass('mdToHtml renders h1, strong, and anchor');
else fail(`markdown output=${rendered}`);

const escaped = mdToHtml('<script>alert(1)</script>');
if (escaped.includes('&lt;script&gt;') && !escaped.includes('<script>')) pass('mdToHtml escapes script tags');
else fail(`escaped output=${escaped}`);

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
const headers = { cookie: `hub=${cookieValue('test-token')}` };

async function request(pathname) {
  if (base) return fetch(`${base}${pathname}`, { headers });
  const url = new URL(pathname, 'http://hub.local');
  const entry = route({ root: FIX, token: 'test-token' }).find(candidate =>
    candidate.method === 'GET' && (candidate.pattern.endsWith('*')
      ? url.pathname.startsWith(candidate.pattern.slice(0, -1))
      : url.pathname === candidate.pattern));
  const chunks = [];
  const response = {
    status: 200,
    headersSent: false,
    writeHead(status) { this.status = status; this.headersSent = true; },
    end(chunk = '') { chunks.push(Buffer.from(chunk)); },
  };
  await entry.handler({}, response, url);
  const body = Buffer.concat(chunks).toString('utf8');
  return { status: response.status, text: async () => body, json: async () => JSON.parse(body) };
}

try {
  let response = await request('/api/apps?q=acme');
  let data = await response.json();
  if (response.status === 200 && data.rows.length === 1) pass('api q=acme returns 1 row');
  else fail(`q status=${response.status} data=${JSON.stringify(data)}`);

  response = await request('/api/apps?status=Applied');
  data = await response.json();
  if (response.status === 200 && data.rows.length === 1) pass('api status=Applied returns 1 row');
  else fail(`status filter status=${response.status} data=${JSON.stringify(data)}`);

  response = await request('/api/apps?minScore=4');
  data = await response.json();
  if (response.status === 200 && data.rows.length === 3) pass('api minScore=4 returns 3 rows');
  else fail(`score filter status=${response.status} data=${JSON.stringify(data)}`);

  response = await request('/apps/1');
  const html = await response.text();
  if (response.status === 200 && html.includes('Acme Robotics') && html.includes('Interview')
    && html.includes('class="tabs"') && html.includes('Jane Doe')) {
    pass('application detail renders facts, tabs, and people');
  } else fail(`detail status=${response.status}`);

  response = await request('/apps/999');
  if (response.status === 404) pass('unknown application returns 404');
  else fail(`unknown application status=${response.status}`);

  response = await request('/files/resume/1');
  if (response.status === 404) pass('missing resume returns 404');
  else fail(`missing resume status=${response.status}`);
} finally {
  if (base) await new Promise(resolve => srv.close(resolve));
}
