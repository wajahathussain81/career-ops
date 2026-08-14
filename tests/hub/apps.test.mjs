import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — applications');
const FIX = join(ROOT, 'tests/hub/fixtures');
const { mdToHtml } = await import(pathToFileURL(join(ROOT, 'hub/lib/md.mjs')).href);
const serverModule = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);
const { applicationsData, createServer, route } = serverModule;
const { cookieValue } = await import(pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href);
const { renderContacts } = await import(pathToFileURL(join(ROOT, 'hub/views/contacts.mjs')).href);
const { renderApplicationDetail } = await import(pathToFileURL(join(ROOT, 'hub/views/appdetail.mjs')).href);
const { renderApps } = await import(pathToFileURL(join(ROOT, 'hub/views/apps.mjs')).href);

const sortFixture = await mkdtemp(join(tmpdir(), 'career-ops-hub-apps-'));
await mkdir(join(sortFixture, 'data'), { recursive: true });
await mkdir(join(sortFixture, 'templates'), { recursive: true });
await writeFile(join(sortFixture, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 7 | 2026-08-07 | Zulu Labs | Engineer | 4.0/5 | Applied | ❌ | | |
| 2 | 2026-08-02 | alpha Labs | Engineer | 4.0 | Interview | ❌ | | |
| 9 | 2026-08-09 | Beta Works | Analyst | N/A | Evaluated | ❌ | | |
| 4 | 2026-08-04 | Alpha Labs | Designer | 4.5/5 | Mystery | ❌ | | |
| 3 | 2026-08-03 | beta Works | Analyst | — | Rejected | ❌ | | |
| 1 | 2026-08-01 | ALPHA LABS | Engineer | 4.5 | Offer | ❌ | | |
`);
await writeFile(join(sortFixture, 'templates', 'states.yml'), `states:
  - label: Evaluated
  - label: Applied
  - label: Responded
  - label: Interview
  - label: Offer
  - label: Rejected
`);

const sortedNums = params => applicationsData(sortFixture, new URLSearchParams(params))
  .rows.map(row => row.num);

if (typeof applicationsData !== 'function') {
  fail('applicationsData is exported for focused sorting tests');
} else {
  let data = applicationsData(sortFixture, new URLSearchParams('sort=score&dir=desc'));
  if (JSON.stringify(data.rows.map(row => row.num)) === JSON.stringify([1, 4, 2, 7, 3, 9])
    && data.sort === 'score' && data.dir === 'desc') {
    pass('score desc sorts numerically with sentinels last');
  } else fail(`score desc data=${JSON.stringify(data)}`);

  if (JSON.stringify(sortedNums('sort=status')) === JSON.stringify([9, 7, 2, 1, 3, 4])) {
    pass('status asc follows canonical pipeline stage order');
  } else fail(`status order=${JSON.stringify(sortedNums('sort=status'))}`);

  if (JSON.stringify(sortedNums('sort=company&dir=asc')) === JSON.stringify([1, 2, 4, 3, 9, 7])) {
    pass('company asc is locale-aware and caseless');
  } else fail(`company order=${JSON.stringify(sortedNums('sort=company&dir=asc'))}`);

  if (JSON.stringify(sortedNums('sort=bogus&dir=desc')) === JSON.stringify([7, 2, 9, 4, 3, 1])) {
    pass('invalid sort preserves tracker order');
  } else fail(`invalid sort order=${JSON.stringify(sortedNums('sort=bogus&dir=desc'))}`);

  if (JSON.stringify(sortedNums('sort=role&dir=asc')) === JSON.stringify([3, 9, 4, 1, 2, 7])) {
    pass('equal sort keys use numeric application number ascending');
  } else fail(`stable tie order=${JSON.stringify(sortedNums('sort=role&dir=asc'))}`);
}

const sortedHtml = renderApps({
  rows: [],
  statuses: [],
  filters: { sort: 'score', dir: 'desc' },
});
if (sortedHtml.includes('<th aria-sort="descending"><button type="button" class="th-sort" data-sort="score">Score <span class="sort-caret" aria-hidden="true">▼</span></button></th>')) {
  pass('renderApps marks the active header and descending caret');
} else fail(`sorted applications header=${sortedHtml}`);

const rendered = mdToHtml('# T\n**b** and [l](http://x)');
if (rendered.includes('<h1>') && rendered.includes('<strong>')
  && rendered.includes('<a href="http://x"')) pass('mdToHtml renders h1, strong, and anchor');
else fail(`markdown output=${rendered}`);

const renderedTable = mdToHtml('| Name | Notes |\n|---|---|\n| Acme | A long note |');
if (renderedTable.includes('<div class="table-scroll"><table>')
  && renderedTable.includes('</table></div>')) pass('mdToHtml wraps tables without changing table semantics');
else fail(`markdown table output=${renderedTable}`);

const escaped = mdToHtml('<script>alert(1)</script>');
if (escaped.includes('&lt;script&gt;') && !escaped.includes('<script>')) pass('mdToHtml escapes script tags');
else fail(`escaped output=${escaped}`);

for (const scheme of ['javascript:alert(1)', 'data:text/html,boom', 'vbscript:msgbox(1)']) {
  const unsafe = mdToHtml(`[x](${scheme})`);
  if (unsafe.includes('x') && !unsafe.includes('<a ') && !unsafe.includes('href=')) {
    pass(`mdToHtml rejects ${scheme.split(':')[0]} links`);
  } else fail(`unsafe markdown link rendered=${unsafe}`);
}

for (const href of ['JavaScript:alert(1)', 'java\tscript:alert(1)', ' \u001fjavascript:alert(1) ']) {
  const unsafe = mdToHtml(`[x](${href})`);
  if (unsafe.includes('x') && !unsafe.includes('<a ') && !unsafe.includes('href=')) {
    pass('mdToHtml rejects obfuscated javascript links');
  } else fail(`obfuscated markdown link rendered=${unsafe}`);
}

for (const href of ['https://example.com', '/reports/1', './report', '../report', '#report', 'report/1', 'mailto:a@b.com', 'tel:+15551234']) {
  const safe = mdToHtml(`[x](${href})`);
  if (safe.includes(`<a href="${href}">x</a>`)) pass(`mdToHtml allows ${href}`);
  else fail(`safe markdown link rendered=${safe}`);
}

const escapedHref = mdToHtml('[x](https://example.com?a=1&b=2)');
if (escapedHref.includes('<a href="https://example.com?a=1&amp;b=2">x</a>')) {
  pass('mdToHtml validates and preserves HTML-escaped URLs');
} else fail(`HTML-escaped markdown link rendered=${escapedHref}`);

const unsafeContact = {
  name: 'Unsafe Contact',
  company: 'Acme',
  type: 'recruiter',
  title: 'Recruiter',
  linkedin: 'javascript:alert(1)',
};
const contactsHtml = renderContacts([unsafeContact]);
if (contactsHtml.includes('LinkedIn') && !contactsHtml.includes('href="javascript:')) {
  pass('contacts view renders unsafe LinkedIn URL without an anchor');
} else fail(`unsafe contacts output=${contactsHtml}`);

const safeContactsHtml = renderContacts([{ ...unsafeContact, linkedin: 'https://linkedin.example/person?a=1&b=2' }]);
if (safeContactsHtml.includes('href="https://linkedin.example/person?a=1&amp;b=2"')) {
  pass('contacts view preserves a safe LinkedIn anchor');
} else fail(`safe contacts output=${safeContactsHtml}`);

const detailHtml = renderApplicationDetail({
  app: { num: 1, company: 'Acme', role: 'Engineer' },
  timeline: [],
  resume: null,
  contacts: [unsafeContact],
  followUps: [],
  statuses: [],
});
if (detailHtml.includes('LinkedIn') && !detailHtml.includes('href="javascript:')) {
  pass('application detail renders unsafe LinkedIn URL without an anchor');
} else fail(`unsafe application detail output=${detailHtml}`);

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
    status: response.status,
    headers: response.headers,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
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

  response = await request('/api/apps?sort=score&dir=desc');
  data = await response.json();
  if (response.status === 200
    && JSON.stringify(data.rows.map(row => row.num)) === JSON.stringify([1, 4, 2, 3])
    && data.sort === 'score' && data.dir === 'desc') {
    pass('api score sorting returns ordered rows and active sort state');
  } else fail(`api score sort status=${response.status} data=${JSON.stringify(data)}`);

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
  if (response.status === 200 && response.headers.get('content-type') === 'application/pdf') {
    pass('uploaded resume returns PDF');
  } else fail(`resume status=${response.status} content-type=${response.headers.get('content-type')}`);
} finally {
  if (base) await new Promise(resolve => srv.close(resolve));
  await rm(sortFixture, { recursive: true, force: true });
}
