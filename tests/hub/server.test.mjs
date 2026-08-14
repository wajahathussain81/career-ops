// tests/hub/server.test.mjs — auth gate + login + static assets
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { Readable, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'url';

console.log('\nHub — server auth');
const { createServer, route } = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);
const { cookieValue } = await import(pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href);
const srv = createServer({
  root: join(ROOT, 'tests/hub/fixtures'),
  token: 'test-token',
  cookieSecure: true,
});
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

async function request(pathname, options = {}) {
  if (base) return fetch(base + pathname, options);

  const requestHeaders = Object.fromEntries(new Headers(options.headers).entries());
  requestHeaders.host ||= 'hub.local';
  const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
  req.url = pathname;
  req.method = options.method || 'GET';
  req.headers = requestHeaders;

  return new Promise((resolveRequest, rejectRequest) => {
    const chunks = [];
    const responseHeaders = new Headers();
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    res.statusCode = 200;
    res.headersSent = false;
    res.setHeader = (name, value) => responseHeaders.set(name, value);
    res.writeHead = (status, headers = {}) => {
      res.statusCode = status;
      res.headersSent = true;
      for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
      return res;
    };
    res.once('finish', () => {
      const body = Buffer.concat(chunks);
      resolveRequest({
        status: res.statusCode,
        headers: responseHeaders,
        text: async () => body.toString('utf8'),
        json: async () => JSON.parse(body.toString('utf8')),
        arrayBuffer: async () => body,
      });
    });
    res.once('error', rejectRequest);
    srv.emit('request', req, res);
  });
}

let r = await request('/', { redirect: 'manual' });
if (r.status === 302 && r.headers.get('location') === '/login') pass('unauthed / redirects to /login');
else fail(`unauthed / gave ${r.status} ${r.headers.get('location')}`);

r = await request('/login');
if (r.status === 200) pass('login page is public'); else fail(`login gave ${r.status}`);

r = await request('/login', { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=wrong' });
if (r.status === 401) pass('wrong token rejected'); else fail(`wrong token gave ${r.status}`);

r = await request('/login', { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=test-token' });
const cookie = (r.headers.get('set-cookie') || '');
if (r.status === 302 && cookie.includes('hub=')
  && cookie.includes('SameSite=Strict') && cookie.includes('Secure')) {
  pass('correct token sets a secure strict same-site cookie + redirects');
}
else fail(`login gave ${r.status} cookie=${cookie}`);

r = await request('/', { headers: { cookie: `hub=${cookieValue('test-token')}` } });
const html = await r.text();
if (r.status === 200) pass('authed / renders'); else fail(`authed / gave ${r.status}`);
if (html.includes('hub.css?v=') && r.headers.get('cache-control') === 'no-store') pass('HTML uses versioned assets and no-store');
else fail(`HTML caching incorrect: cache-control=${r.headers.get('cache-control')}`);

r = await request('/packages', { headers: { cookie: `hub=${cookieValue('test-token')}` } });
const packagesHtml = await r.text();
if (r.status === 200
  && packagesHtml.includes('<h1>Packages</h1>')
  && packagesHtml.includes('Acme Robotics')
  && packagesHtml.includes('Firmware Engineer')
  && packagesHtml.includes('href="/files/resume/1"')
  && packagesHtml.includes('href="/files/cover/1"')
  && packagesHtml.includes('href="/apps/1">Report #001</a>')) {
  pass('packages page renders tracker context and artifact links');
} else fail(`packages page gave ${r.status}`);

r = await request('/files/cover/1', {
  headers: { cookie: `hub=${cookieValue('test-token')}` },
});
const coverBody = Buffer.from(await r.arrayBuffer()).toString('utf8');
if (r.status === 200
  && r.headers.get('content-type') === 'application/pdf'
  && r.headers.get('cache-control') === 'private, no-store'
  && r.headers.get('x-content-type-options') === 'nosniff'
  && coverBody.includes('%PDF-1.4')) {
  pass('cover route serves a private nosniff PDF');
} else fail(`cover route gave ${r.status} content-type=${r.headers.get('content-type')}`);

r = await request('/files/cover/2', {
  headers: { cookie: `hub=${cookieValue('test-token')}` },
});
if (r.status === 404) pass('cover route returns 404 when the PDF is absent');
else fail(`missing cover gave ${r.status}`);

r = await request('/api/chat/status', {
  headers: { cookie: `hub=${cookieValue('test-token')}` },
});
let chatStatus = null;
try {
  chatStatus = await r.json();
} catch {
  chatStatus = null;
}
if (r.status === 200 && typeof chatStatus?.running === 'boolean') {
  pass('chat status returns an authenticated boolean running state');
} else {
  fail(`chat status gave ${r.status} body=${JSON.stringify(chatStatus)}`);
}

r = await request('/assets/hub.css?v=abc');
const versionedCacheControl = r.headers.get('cache-control') || '';
const versionedStatus = r.status;

r = await request('/assets/hub.css');
const bareCacheControl = r.headers.get('cache-control');
if (r.status === 200 && (await r.text()).includes('--ground')) pass('assets served without auth, tokens present');
else fail('hub.css missing or lacks --ground token');
if (versionedStatus === 200 && versionedCacheControl.includes('immutable') && bareCacheControl === 'no-cache') {
  pass('assets use immutable versioned caching and no-cache fallback');
} else {
  fail(`asset caching incorrect: versioned=${versionedCacheControl}, bare=${bareCacheControl}`);
}

r = await request('/files/prep-resume/acme-firmware-1', {
  headers: { cookie: `hub=${cookieValue('test-token')}` },
});
await r.arrayBuffer();
if (r.status === 200 && r.headers.get('cache-control') === 'private, no-store') {
  pass('resume responses use private no-store caching');
} else {
  fail(`resume caching incorrect: status=${r.status} cache-control=${r.headers.get('cache-control')}`);
}

if (r.headers.get('x-content-type-options') === 'nosniff') pass('responses disable content sniffing');
else fail(`resume missing nosniff: ${r.headers.get('x-content-type-options')}`);

r = await request('/api/chat/kill', {
  method: 'POST',
  headers: { cookie: `hub=${cookieValue('test-token')}` },
});
if (r.status === 200 && (await r.json()).ok === true) {
  pass('chat kill accepts an empty request without content-type');
} else fail(`bodyless chat kill gave ${r.status}`);

r = await request('/api/chat/kill', {
  method: 'POST',
  headers: {
    cookie: `hub=${cookieValue('test-token')}`,
    origin: 'http://evil.example',
  },
});
if (r.status === 403 && (await r.json()).error === 'bad origin') {
  pass('cross-origin chat kill is rejected');
} else fail(`cross-origin chat kill gave ${r.status}`);

const eventApp = { eventClients: new Set() };
const eventsRoute = route(eventApp).find(entry =>
  entry.method === 'GET' && entry.pattern === '/api/events');
const eventResponses = [];
function eventResponse() {
  const response = new EventEmitter();
  response.destroyed = false;
  response.status = null;
  response.ended = false;
  response.writeHead = status => { response.status = status; };
  response.flushHeaders = () => {};
  response.write = () => true;
  response.end = () => { response.ended = true; };
  return response;
}
for (let i = 0; i < 24; i += 1) {
  const response = eventResponse();
  eventResponses.push(response);
  eventsRoute.handler({}, response, new URL('/api/events', 'http://hub.local'));
}
const overflowEvents = eventResponse();
eventsRoute.handler({}, overflowEvents, new URL('/api/events', 'http://hub.local'));
if (eventApp.eventClients.size === 24
  && overflowEvents.status === 503 && overflowEvents.ended) {
  pass('SSE connections are capped at 24 clients');
} else {
  fail(`SSE cap size=${eventApp.eventClients.size} status=${overflowEvents.status} ended=${overflowEvents.ended}`);
}
for (const response of eventResponses) response.emit('close');

let slowWrites = 0;
const slowResponse = new EventEmitter();
slowResponse.destroyed = false;
slowResponse.writeHead = () => {};
slowResponse.flushHeaders = () => {};
slowResponse.write = () => { slowWrites += 1; return false; };
slowResponse.end = () => {};
const slowRequest = Readable.from([]);
slowRequest.url = '/api/events';
slowRequest.method = 'GET';
slowRequest.headers = {
  cookie: `hub=${cookieValue('test-token')}`,
  host: 'hub.local',
};
srv.emit('request', slowRequest, slowResponse);
srv.hubBroadcast('test', { value: 1 });
srv.hubBroadcast('test', { value: 2 });
slowResponse.emit('drain');
srv.hubBroadcast('test', { value: 3 });
slowResponse.emit('close');
if (slowWrites === 2) {
  pass('SSE broadcast pauses a backpressured client until drain');
} else fail(`slow SSE client received ${slowWrites} writes`);

if (base) await new Promise(resolve => srv.close(resolve));
