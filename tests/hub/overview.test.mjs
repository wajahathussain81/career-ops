import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — overview');
const FIX = join(ROOT, 'tests/hub/fixtures');
const { createServer } = await import(
  pathToFileURL(join(ROOT, 'hub/server.mjs')).href
);
const { cookieValue } = await import(
  pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href
);

const srv = createServer({ root: FIX, token: 'test-token' });
await new Promise(resolve => srv.listen(0, resolve));
const base = `http://127.0.0.1:${srv.address().port}`;
const headers = { cookie: `hub=${cookieValue('test-token')}` };

try {
  const apiResponse = await fetch(`${base}/api/overview`, { headers });
  const overview = apiResponse.ok ? await apiResponse.json() : null;

  if (overview?.funnel?.ever?.applied === 3) pass('overview API reports ever applied');
  else fail(`ever.applied=${overview?.funnel?.ever?.applied}`);

  if (overview?.inbox === 2) pass('overview API reports pipeline inbox');
  else fail(`inbox=${overview?.inbox}`);

  if (overview?.recent?.length === 6) pass('overview API returns all recent rows');
  else fail(`recent.length=${overview?.recent?.length}`);

  const pageResponse = await fetch(`${base}/`, { headers });
  const html = await pageResponse.text();
  if (html.includes('tile-quota') && html.includes('Acme Robotics')) {
    pass('overview HTML renders quota and upcoming interview');
  } else {
    fail('overview HTML missing quota tile or upcoming interview');
  }
} finally {
  await new Promise(resolve => srv.close(resolve));
}
