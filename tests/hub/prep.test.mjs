import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — interview prep');
const FIX = join(ROOT, 'tests/hub/fixtures');
const { loadPrepPage } = await import(pathToFileURL(join(ROOT, 'hub/lib/data.mjs')).href);
const { renderPrepPage } = await import(pathToFileURL(join(ROOT, 'hub/gen-prep.mjs')).href);
const { createServer, route } = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);
const { cookieValue } = await import(pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href);

const fragment = renderPrepPage(loadPrepPage(FIX, 'acme-firmware-1'));
if (fragment.includes('data-dt="2030-01-15T11:00:00-07:00"')) {
  pass('prep fragment includes the interview datetime');
} else fail('prep fragment missing interview datetime');

if (fragment.includes('class="say"') && fragment.includes('flag proof')
  && fragment.includes('<strong>CI pipeline</strong>') && fragment.includes('01')) {
  pass('prep fragment renders artifact sections and markdown');
} else fail(`prep fragment missing required markup: ${fragment}`);

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
  return { status: response.status, text: async () => body };
}

try {
  let response = await request('/prep');
  let html = await response.text();
  if (response.status === 200 && html.includes('Acme Robotics')) {
    pass('prep index renders future interview tab');
  } else fail(`prep index status=${response.status}`);

  response = await request('/prep/acme-firmware-1');
  if (response.status === 200) pass('known prep page returns 200');
  else fail(`known prep page status=${response.status}`);

  response = await request('/prep/missing');
  if (response.status === 404) pass('unknown prep page returns 404');
  else fail(`unknown prep page status=${response.status}`);
} finally {
  if (base) await new Promise(resolve => srv.close(resolve));
}

try {
  const stdout = execFileSync(process.execPath, [join(ROOT, 'hub/gen-prep.mjs'), 'acme-firmware-1'], {
    cwd: ROOT,
    env: { ...process.env, HUB_ROOT: FIX },
    encoding: 'utf8',
  });
  if (stdout.includes('class="say"')) pass('prep CLI renders the requested page');
  else fail('prep CLI output missing say markup');
} catch (error) {
  fail(`prep CLI exited ${error?.status ?? 'unknown'}: ${error?.stderr ?? error?.message}`);
}
