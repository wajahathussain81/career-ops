import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — interview prep');
const FIX = join(ROOT, 'tests/hub/fixtures');
const { loadPrepPage } = await import(pathToFileURL(join(ROOT, 'hub/lib/data.mjs')).href);
const { renderPrepPage } = await import(pathToFileURL(join(ROOT, 'hub/gen-prep.mjs')).href);
const { createServer, route } = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);
const { cookieValue } = await import(pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href);

const fragment = renderPrepPage(loadPrepPage(FIX, 'acme-firmware-1'));
if (fragment.includes('<span class="countdown" data-dt="2030-01-15T11:00:00-07:00"></span>')) {
  pass('prep fragment includes the interview datetime');
} else fail('prep fragment missing interview datetime');

const sectionIds = [...fragment.matchAll(/<section class="sec(?: [^"]+)?" id="(sec-\d+)"/g)]
  .map(match => match[1]);
const tocTargets = [...fragment.matchAll(/<a href="#(sec-\d+)">/g)]
  .map(match => match[1]);
if (fragment.includes('class="prep-shell"') && fragment.includes('class="prep-rail"')
  && fragment.includes('class="prep-main"')
  && sectionIds.length === 3 && JSON.stringify(tocTargets) === JSON.stringify(sectionIds)) {
  pass('prep fragment renders a rail TOC linked to stable section anchors');
} else fail(`prep fragment missing shell or matching section anchors: ${fragment}`);

if (fragment.includes('class="sec') && !fragment.includes('<details')
  && fragment.includes('class="say"') && fragment.includes('flag proof')
  && fragment.includes('<strong>CI pipeline</strong>') && fragment.includes('01')) {
  pass('prep fragment renders flat artifact sections and markdown');
} else fail(`prep fragment missing required markup: ${fragment}`);

const workRoot = await mkdtemp(join(tmpdir(), 'career-ops-hub-prep-workspace-'));
await cp(FIX, workRoot, { recursive: true });
const prepDir = join(workRoot, 'interview-prep/acme-firmware-1');
await writeFile(join(prepDir, 'qa.yml'), `sections:
  - title: General
    questions:
      - id: gen-1
        q: Tell me about yourself.
        source: agent
        agent_answer: |-
          Lead with **reliable delivery** and the firmware story.
        answer: |-
          Lead with the <firmware> story.
      - id: gen-empty
        q: What would you improve first?
        source: agent
        answer: ''
`);
await writeFile(join(prepDir, 'notes.md'), '# Last check\n\nAsk about the lab setup.\n');

function prepPageYaml(company, role) {
  return `meta:
  company: ${company}
  role: ${role}
  tracker: 1
  round: Hiring manager
  datetime: 2030-02-15T11:00:00-07:00
  duration_min: 45
  platform: Teams
  interviewer: Pat Smith
sections: []
`;
}

const noQaRenderDir = join(workRoot, 'interview-prep/no-qa-render');
await mkdir(noQaRenderDir, { recursive: true });
await writeFile(join(noQaRenderDir, 'page.yml'), prepPageYaml('Render Corp', 'Platform Engineer'));

const noQaAnswerDir = join(workRoot, 'interview-prep/no-qa-answer');
await mkdir(noQaAnswerDir, { recursive: true });
await writeFile(join(noQaAnswerDir, 'page.yml'), prepPageYaml('Answer Corp', 'Systems Engineer'));

const variantQaDir = join(workRoot, 'interview-prep/variant-qa');
await mkdir(variantQaDir, { recursive: true });
await writeFile(join(variantQaDir, 'page.yml'), prepPageYaml('Variant Corp', 'Controls Engineer'));
await writeFile(join(variantQaDir, 'qa.yml'), `sections:
  - title: Opening
    questions:
      - id: custom-opening
        q: Tell me about yourself and the work most relevant to this role.
        source: agent
        answer: ''
`);

const orderedQaDir = join(workRoot, 'interview-prep/ordered-qa');
await mkdir(orderedQaDir, { recursive: true });
await writeFile(join(orderedQaDir, 'page.yml'), prepPageYaml('Ordered Corp', 'Test Engineer'));
await writeFile(join(orderedQaDir, 'qa.yml'), `sections:
  - title: General
    questions:
      - id: custom-warmup
        q: What should we know before we begin?
        source: agent
        answer: ''
      - id: legacy-tell
        q: Tell me about yourself and your recent work.
        source: agent
        answer: ''
      - id: gen-why-company
        q: Why do you want to work at Ordered Corp specifically?
        source: agent
        answer: ''
      - id: gen-why-this-role
        q: Why are you interested in this test engineering role?
        source: agent
        answer: ''
      - id: gen-why-leaving
        q: Why did you leave your last role, and what are you seeking next?
        source: agent
        answer: ''
      - id: gen-strengths-weaknesses
        q: What are your strengths, and what weakness are you addressing?
        source: agent
        answer: ''
      - id: custom-growth
        q: Where do you want to grow next?
        source: agent
        answer: ''
`);

const srv = createServer({ root: workRoot, token: 'test-token', watch: false });
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

async function request(pathname, options = {}) {
  const requestHeaders = { ...headers, ...(options.headers || {}) };
  if (base) return fetch(`${base}${pathname}`, { ...options, headers: requestHeaders });
  return requestServer(srv, pathname, { ...options, headers: requestHeaders });
}

async function requestServer(server, pathname, options = {}) {
  const chunks = [];
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  response.statusCode = 200;
  response.responseHeaders = new Headers();
  response.writeHead = function writeHead(status, responseHeaders = {}) {
    this.statusCode = status;
    this.headersSent = true;
    for (const [name, value] of Object.entries(responseHeaders)) {
      this.responseHeaders.set(name, value);
    }
    return this;
  };
  const finished = new Promise((resolve, reject) => {
    response.once('finish', resolve);
    response.once('error', reject);
  });
  const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
  req.url = pathname;
  req.method = options.method || 'GET';
  req.headers = { host: 'hub.local', ...(options.headers || {}) };
  server.emit('request', req, response);
  await finished;
  const buffered = Buffer.concat(chunks);
  return {
    status: response.statusCode,
    headers: response.responseHeaders,
    text: async () => buffered.toString('utf8'),
    json: async () => JSON.parse(buffered.toString('utf8')),
  };
}

async function requestRoute(root, pathname) {
  const url = new URL(pathname, 'http://hub.local');
  const entry = route({ root, token: 'test-token' }).find(candidate =>
    candidate.method === 'GET' && (candidate.pattern.endsWith('*')
      ? url.pathname.startsWith(candidate.pattern.slice(0, -1))
      : url.pathname === candidate.pattern));
  const chunks = [];
  const response = new PassThrough();
  response.status = 200;
  response.responseHeaders = {};
  response.on('data', chunk => chunks.push(Buffer.from(chunk)));
  response.writeHead = function writeHead(status, responseHeaders = {}) {
    this.status = status;
    this.responseHeaders = responseHeaders;
    this.headersSent = true;
  };
  const finished = new Promise((resolve, reject) => {
    response.once('finish', resolve);
    response.once('error', reject);
  });
  try {
    await entry.handler({}, response, url);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(error.message);
  }
  if (!response.writableFinished) await finished;
  const body = Buffer.concat(chunks).toString('utf8');
  return {
    status: response.status,
    headers: { get: name => Object.entries(response.responseHeaders)
      .find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null },
    text: async () => body,
  };
}

try {
  let response = await request('/prep');
  let html = await response.text();
  if (response.status === 200 && html.includes('Acme Robotics')
    && html.includes('class="pane prep-pane" id="prep-pane-0"')
    && !html.includes('class="wrap pane"')) {
    pass('prep index renders future interview tab');
  } else fail(`prep index status=${response.status} or pane remains width-capped`);

  response = await request('/prep/acme-firmware-1');
  html = await response.text();
  const contentTabs = [...html.matchAll(/<button class="tab"[^>]*>([^<]+)<\/button>/g)]
    .map(match => match[1]);
  if (response.status === 200
    && JSON.stringify(contentTabs) === JSON.stringify(['Prep', 'Questions', 'Job description', 'Resume'])
    && html.includes('<h1>Acme JD</h1>')
    && html.includes('Tell me about yourself.')
    && html.includes('Lead with the &lt;firmware&gt; story.')
    && html.includes('data-prep-answer')
    && html.includes('Ask about the lab setup.')
    && html.includes('<main class="hub-main prep-page"')
    && !html.includes('<main class="hub-main wrap">')) {
    pass('known prep page renders prep, questions, JD, resume, and notes workspace');
  } else fail(`known prep page missing content tabs or JD: status=${response.status}`);

  const answeredCardStart = html.indexOf('<article class="prep-qa-card" data-question-id="gen-1">');
  const answeredCardEnd = html.indexOf('</article>', answeredCardStart);
  const answeredCard = html.slice(answeredCardStart, answeredCardEnd);
  if (answeredCard.includes('<div class="prep-agent-answer"><span class="prep-answer-label">AGENT</span>')
    && answeredCard.includes('Lead with <strong>reliable delivery</strong> and the firmware story.')
    && answeredCard.indexOf('prep-agent-answer') < answeredCard.indexOf('<form data-prep-answer-form>')
    && answeredCard.indexOf('>YOU</span>') < answeredCard.indexOf('<textarea')) {
    pass('prep question renders the agent response as markdown above the user editor');
  } else fail('prep question missing rendered agent response markdown');

  if (html.includes('<p class="prep-agent-answer-empty">No agent response yet — ask the agent to draft one.</p>')) {
    pass('prep question without an agent response renders the empty state');
  } else fail('prep question without an agent response missing empty state');

  response = await request('/prep/no-qa-render');
  html = await response.text();
  if (response.status === 200
    && html.includes('>Questions</button>')
    && html.includes('<h2 class="sec-t">General</h2>')
    && html.includes('Tell me about yourself.')
    && html.includes('Why do you want to work at Render Corp?')) {
    pass('prep page without qa.yml renders the General staple questions');
  } else fail(`prep page without qa.yml missing General staples: status=${response.status}`);

  response = await request('/api/prep/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      slug: 'no-qa-answer',
      id: 'gen-tell-me-about-yourself',
      answer: 'I build reliable systems from ambiguous requirements.',
    }),
  });
  let data = await response.json();
  const storedQaText = await readFile(join(noQaAnswerDir, 'qa.yml'), 'utf8').catch(() => '');
  let storedQa = yaml.load(storedQaText);
  const storedStaples = storedQa?.sections?.[0]?.questions ?? [];
  if (response.status === 200 && data.ok === true
    && storedQa.sections[0].title === 'General'
    && storedStaples.length === 6
    && storedStaples[0].id === 'gen-tell-me-about-yourself'
    && storedStaples.every(question => question.agent_answer === '')
    && storedStaples[0].answer === 'I build reliable systems from ambiguous requirements.') {
    pass('prep answer POST materializes missing staples and saves the default answer');
  } else fail(`prep default answer status=${response.status} data=${JSON.stringify(data)}`);

  response = await request('/prep/variant-qa');
  html = await response.text();
  const tellMeQuestionCount = [...html.matchAll(/<p class="prep-question-text">Tell me about yourself/gi)].length;
  if (response.status === 200 && tellMeQuestionCount === 1) {
    pass('existing tell-me-about-yourself wording variant is not duplicated');
  } else fail(`tell-me-about-yourself variant count=${tellMeQuestionCount} status=${response.status}`);

  response = await request('/prep/ordered-qa');
  html = await response.text();
  const orderedGeneralStart = html.indexOf('<h2 class="sec-t">General</h2>');
  const orderedGeneralEnd = html.indexOf('</section>', orderedGeneralStart);
  const orderedGeneralHtml = html.slice(orderedGeneralStart, orderedGeneralEnd);
  const orderedGeneralIds = [...orderedGeneralHtml.matchAll(
    /<article class="prep-qa-card" data-question-id="([^"]+)">/g,
  )].map(match => match[1]);
  const expectedGeneralIds = [
    'legacy-tell',
    'custom-warmup',
    'gen-why-company',
    'gen-why-this-role',
    'gen-why-leaving',
    'gen-strengths-weaknesses',
    'custom-growth',
    'gen-questions-for-them',
  ];
  if (response.status === 200
    && JSON.stringify(orderedGeneralIds) === JSON.stringify(expectedGeneralIds)
    && new Set(orderedGeneralIds).size === orderedGeneralIds.length) {
    pass('General keeps tell-me first, stable staples unique, and missing staples last');
  } else fail(`General question order=${JSON.stringify(orderedGeneralIds)} status=${response.status}`);

  response = await request('/api/prep/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      slug: 'acme-firmware-1',
      id: 'gen-1',
      answer: 'Updated from the workspace.',
    }),
  });
  data = await response.json();
  storedQa = yaml.load(await readFile(join(prepDir, 'qa.yml'), 'utf8'));
  const updatedQuestion = storedQa.sections[0].questions.find(question => question.id === 'gen-1');
  if (response.status === 200 && data.ok === true
    && updatedQuestion?.answer === 'Updated from the workspace.'
    && updatedQuestion.agent_answer === 'Lead with **reliable delivery** and the firmware story.') {
    pass('prep answer POST updates the user answer and preserves the agent response');
  } else fail(`prep answer status=${response.status} data=${JSON.stringify(data)}`);

  response = await request('/api/prep/question', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      slug: 'acme-firmware-1',
      section: 'General',
      q: '  What does success look like after 90 days?  ',
    }),
  });
  data = await response.json();
  storedQa = yaml.load(await readFile(join(prepDir, 'qa.yml'), 'utf8'));
  const addedQuestion = storedQa.sections[0].questions.at(-1);
  if (response.status === 200 && data.ok === true && data.id
    && addedQuestion.id === data.id
    && addedQuestion.q === 'What does success look like after 90 days?'
    && addedQuestion.source === 'user' && addedQuestion.answer === '') {
    pass('prep question POST appends a user question with a generated id');
  } else fail(`prep question status=${response.status} data=${JSON.stringify(data)}`);

  response = await request('/api/prep/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'acme-firmware-1', notes: '## New notes\n\nBring examples.' }),
  });
  data = await response.json();
  const storedNotes = await readFile(join(prepDir, 'notes.md'), 'utf8');
  if (response.status === 200 && data.ok === true
    && storedNotes === '## New notes\n\nBring examples.') {
    pass('prep notes POST writes notes.md');
  } else fail(`prep notes status=${response.status} data=${JSON.stringify(data)}`);

  response = await request('/api/prep/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: '../../etc', notes: 'nope' }),
  });
  data = await response.json();
  if ([400, 404].includes(response.status) && data.ok === false) {
    pass('prep mutation rejects a traversal slug');
  } else fail(`prep traversal status=${response.status} data=${JSON.stringify(data)}`);

  const unauthHeaders = { 'content-type': 'application/json' };
  if (base) {
    response = await fetch(`${base}/api/prep/notes`, {
      method: 'POST',
      headers: unauthHeaders,
      body: JSON.stringify({ slug: 'acme-firmware-1', notes: 'nope' }),
      redirect: 'manual',
    });
  } else {
    response = await requestServer(srv, '/api/prep/notes', {
      method: 'POST',
      headers: unauthHeaders,
      body: JSON.stringify({ slug: 'acme-firmware-1', notes: 'nope' }),
    });
  }
  if (response.status === 302 && response.headers.get('location') === '/login') {
    pass('unauthenticated prep mutation is rejected');
  } else fail(`unauthenticated prep mutation status=${response.status}`);

  response = await request('/files/prep-resume/acme-firmware-1');
  if (response.status === 200 && response.headers.get('content-type') === 'application/pdf') {
    pass('prep resume route streams the interview resume PDF');
  } else fail(`prep resume status=${response.status} content-type=${response.headers.get('content-type')}`);

  response = await request('/files/prep-resume/missing');
  if (response.status === 404) pass('missing prep resume returns 404');
  else fail(`missing prep resume status=${response.status}`);

  response = await request('/prep/missing');
  if (response.status === 404) pass('unknown prep page returns 404');
  else fail(`unknown prep page status=${response.status}`);

  const malformedRoot = await mkdtemp(join(tmpdir(), 'career-ops-hub-prep-'));
  try {
    await cp(FIX, malformedRoot, { recursive: true });
    const malformedDir = join(malformedRoot, 'interview-prep/malformed-page');
    await mkdir(malformedDir, { recursive: true });
    await writeFile(join(malformedDir, 'page.yml'), 'meta: [malformed\n');
    response = await requestRoute(malformedRoot, '/prep/malformed-page');
    if (response.status === 404) pass('malformed prep page returns 404 instead of 500');
    else fail(`malformed prep page status=${response.status}`);
  } finally {
    await rm(malformedRoot, { recursive: true, force: true });
  }
} finally {
  if (base) await new Promise(resolve => srv.close(resolve));
  else srv.close();
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
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
