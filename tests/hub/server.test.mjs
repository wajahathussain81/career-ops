// tests/hub/server.test.mjs — auth gate + login + static assets
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nHub — server auth');
const { createServer } = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);
const { cookieValue } = await import(pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href);
const srv = createServer({ root: join(ROOT, 'tests/hub/fixtures'), token: 'test-token' });
await new Promise(r => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;

let r = await fetch(base + '/', { redirect: 'manual' });
if (r.status === 302 && r.headers.get('location') === '/login') pass('unauthed / redirects to /login');
else fail(`unauthed / gave ${r.status} ${r.headers.get('location')}`);

r = await fetch(base + '/login');
if (r.status === 200) pass('login page is public'); else fail(`login gave ${r.status}`);

r = await fetch(base + '/login', { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=wrong' });
if (r.status === 401) pass('wrong token rejected'); else fail(`wrong token gave ${r.status}`);

r = await fetch(base + '/login', { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=test-token' });
const cookie = (r.headers.get('set-cookie') || '');
if (r.status === 302 && cookie.includes('hub=')) pass('correct token sets cookie + redirects');
else fail(`login gave ${r.status} cookie=${cookie}`);

r = await fetch(base + '/', { headers: { cookie: `hub=${cookieValue('test-token')}` } });
const html = await r.text();
if (r.status === 200) pass('authed / renders'); else fail(`authed / gave ${r.status}`);
if (html.includes('hub.css?v=') && r.headers.get('cache-control') === 'no-store') pass('HTML uses versioned assets and no-store');
else fail(`HTML caching incorrect: cache-control=${r.headers.get('cache-control')}`);

r = await fetch(base + '/assets/hub.css?v=abc');
const versionedCacheControl = r.headers.get('cache-control') || '';
const versionedStatus = r.status;

r = await fetch(base + '/assets/hub.css');
const bareCacheControl = r.headers.get('cache-control');
if (r.status === 200 && (await r.text()).includes('--ground')) pass('assets served without auth, tokens present');
else fail('hub.css missing or lacks --ground token');
if (versionedStatus === 200 && versionedCacheControl.includes('immutable') && bareCacheControl === 'no-cache') {
  pass('assets use immutable versioned caching and no-cache fallback');
} else {
  fail(`asset caching incorrect: versioned=${versionedCacheControl}, bare=${bareCacheControl}`);
}

srv.close();
