import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — overview');
const FIX = join(ROOT, 'tests/hub/fixtures');
const { createServer, route } = await import(
  pathToFileURL(join(ROOT, 'hub/server.mjs')).href
);
const { renderOverview } = await import(
  pathToFileURL(join(ROOT, 'hub/views/overview.mjs')).href
);
const { cookieValue } = await import(
  pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href
);

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

const customQuota = renderOverview({ quotaToday: { applied: 2, target: 3 } });
const quotaSegments = customQuota.match(/class="quota-segment/g) ?? [];
if (customQuota.includes('aria-valuemax="3"') && customQuota.includes('2/3')
  && quotaSegments.length === 3) pass('overview quota uses the supplied target');
else fail(`quota HTML=${customQuota}`);

async function request(pathname) {
  if (base) return fetch(`${base}${pathname}`, { headers });
  const url = new URL(pathname, 'http://hub.local');
  const entry = route({ root: FIX, token: 'test-token' }).find(candidate =>
    candidate.method === 'GET' && candidate.pattern === url.pathname);
  const chunks = [];
  const response = new PassThrough();
  response.status = 200;
  response.headers = new Headers();
  response.writeHead = function writeHead(status, responseHeaders = {}) {
    this.status = status;
    this.headers = new Headers(responseHeaders);
  };
  response.on('data', chunk => chunks.push(Buffer.from(chunk)));
  const completed = new Promise((resolve, reject) => {
    response.once('end', resolve);
    response.once('error', reject);
  });
  await entry.handler({}, response, url);
  await completed;
  const body = Buffer.concat(chunks).toString('utf8');
  return {
    ok: response.status >= 200 && response.status < 300,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

try {
  const apiResponse = await request('/api/overview');
  const overview = apiResponse.ok ? await apiResponse.json() : null;

  if (overview?.funnel?.ever?.applied === 3) pass('overview API reports ever applied');
  else fail(`ever.applied=${overview?.funnel?.ever?.applied}`);

  if (overview?.inbox === 2) pass('overview API reports pipeline inbox');
  else fail(`inbox=${overview?.inbox}`);

  if (overview?.recent?.length === 6) pass('overview API returns all recent rows');
  else fail(`recent.length=${overview?.recent?.length}`);

  const pageResponse = await request('/');
  const html = await pageResponse.text();
  if (html.includes('tile-quota') && html.includes('Acme Robotics')) {
    pass('overview HTML renders quota and upcoming interview');
  } else {
    fail('overview HTML missing quota tile or upcoming interview');
  }
} finally {
  if (base) await new Promise(resolve => srv.close(resolve));
}
