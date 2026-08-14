// tests/hub/archive.test.mjs — session transcript archive (data + views + routes)
import { PassThrough } from 'node:stream';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — archive');
const FIX = join(ROOT, 'tests/hub/fixtures');
const d = await import(pathToFileURL(join(ROOT, 'hub/lib/data.mjs')).href);
const { renderArchiveIndex, renderArchiveSession } = await import(
  pathToFileURL(join(ROOT, 'hub/views/archive.mjs')).href
);
const { route } = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);

// --- listSessions ---------------------------------------------------------

const sessions = d.listSessions(FIX);

if (sessions.length === 2) pass('listSessions returns only the two parseable fixture sessions');
else fail(`listSessions length=${sessions.length}: ${JSON.stringify(sessions.map(s => s.slug))}`);

if (!sessions.some(s => s.slug === 'malformed-missing-frontmatter')) {
  pass('listSessions skips a file with no front matter instead of throwing');
} else fail('malformed fixture (no front matter) was not skipped');

if (!sessions.some(s => s.company === 'Ignore Me' || s.slug === 'README')) {
  pass('listSessions excludes README.md');
} else fail('README.md leaked into listSessions output');

const [newest, oldest] = sessions;
if (newest?.slug === 'acme-firmware-hiring-manager-2026-01-10'
  && oldest?.slug === 'acme-firmware-screen-2026-01-05') {
  pass('listSessions sorts newest date first');
} else fail(`sort order=${JSON.stringify(sessions.map(s => s.slug))}`);

if (newest?.date === '2026-01-10' && typeof newest.date === 'string') {
  pass('listSessions normalizes front-matter date to a YYYY-MM-DD string');
} else fail(`date=${JSON.stringify(newest?.date)}`);

if (newest?.company === 'Acme Robotics' && newest.role === 'Firmware Engineer'
  && newest.round === 'hiring-manager' && newest.interviewerRole === 'Engineering Director'
  && newest.source === 'debrief') {
  pass('listSessions parses front-matter meta fields');
} else fail(`meta=${JSON.stringify(newest)}`);

if (newest?.turns.length === 2) pass('listSessions parses both Q turns');
else fail(`turns length=${newest?.turns.length}`);

const [turn1, turn2] = newest?.turns ?? [];
if (JSON.stringify(turn1?.competencies) === JSON.stringify(['self-presentation'])) {
  pass('listSessions parses the competency comment tag on a turn');
} else fail(`turn1 competencies=${JSON.stringify(turn1?.competencies)}`);

if (Array.isArray(turn2?.competencies) && turn2.competencies.length === 0) {
  pass('listSessions defaults competencies to [] when no comment tag is present');
} else fail(`turn2 competencies=${JSON.stringify(turn2?.competencies)}`);

if (turn2?.a.includes('\n\n') && turn2.a.includes('Multi-paragraph continuation')) {
  pass('listSessions preserves paragraph breaks in a multi-paragraph answer');
} else fail(`turn2 answer=${JSON.stringify(turn2?.a)}`);

if (newest?.candidateQuestions.length === 1
  && newest.candidateQuestions[0] === "What's the team structure?") {
  pass('listSessions parses the Candidate Questions section');
} else fail(`candidateQuestions=${JSON.stringify(newest?.candidateQuestions)}`);

if (oldest?.turns.length === 1
  && JSON.stringify(oldest.turns[0].competencies) === JSON.stringify(['motivation', 'culture-fit'])
  && oldest.candidateQuestions.length === 0) {
  pass('listSessions parses the older single-turn session with a multi-tag competency comment');
} else fail(`oldest session=${JSON.stringify(oldest)}`);

if (d.listSessions(join(FIX, 'nonexistent')).length === 0) {
  pass('listSessions degrades to [] when interview-prep/sessions is missing');
} else fail('missing sessions dir did not degrade to []');

// --- sessionMatchesPrepSlug -------------------------------------------------

if (d.sessionMatchesPrepSlug('Magnet Forensics', 'magnetforensics-sdet-739')
  && !d.sessionMatchesPrepSlug('Magnet Forensics', 'generalmotors-sil-338')) {
  pass('sessionMatchesPrepSlug fuzzy-matches a company against a prep slug');
} else fail('sessionMatchesPrepSlug fuzzy match behaved unexpectedly');

// --- renderArchiveIndex -----------------------------------------------------

const groupedSessions = [
  {
    slug: 'x-hiring-manager', company: 'Test Co', role: 'Engineer', round: 'hiring-manager',
    date: '2026-01-10', interviewerRole: 'Director', source: 'debrief',
    turns: [{ q: 'Q1', competencies: [], a: 'A1' }], candidateQuestions: [],
  },
  {
    slug: 'x-screen', company: 'Test Co', role: 'Engineer', round: 'screen',
    date: '2026-01-05', interviewerRole: 'Recruiter', source: 'debrief',
    turns: [{ q: 'Q2', competencies: [], a: 'A2' }], candidateQuestions: [],
  },
];
const pastPrep = [
  {
    slug: 'test-co-engineer-1', company: 'Test Co', role: 'Engineer',
    datetime: '2026-01-01T10:00:00-05:00', hasTranscript: true,
  },
  {
    slug: 'other-co-role-2', company: '<script>alert(1)</script>', role: 'Role',
    datetime: '2025-12-01T09:00:00-05:00', hasTranscript: false,
  },
];
const indexHtml = renderArchiveIndex({ sessions: groupedSessions, pastPrep });

if ((indexHtml.match(/Test Co/g) || []).length >= 1
  && indexHtml.includes('archive-engagement')
  && (indexHtml.match(/class="archive-engagement"/g) || []).length === 1) {
  pass('renderArchiveIndex groups same company+role sessions into one engagement card');
} else fail('renderArchiveIndex did not group sessions by company+role into one card');

const screenIndex = indexHtml.indexOf('href="/archive/x-screen"');
const hmIndex = indexHtml.indexOf('href="/archive/x-hiring-manager"');
if (screenIndex !== -1 && hmIndex !== -1 && screenIndex < hmIndex) {
  pass('renderArchiveIndex lists rounds within an engagement chronologically');
} else fail(`round order screenIndex=${screenIndex} hmIndex=${hmIndex}`);

if (indexHtml.includes('href="/prep/test-co-engineer-1"') && indexHtml.includes('Prep page')) {
  pass('renderArchiveIndex links a matched engagement to its prep page');
} else fail('renderArchiveIndex missing Prep page link for matched engagement');

if (indexHtml.includes('Prep pages without transcripts')
  && indexHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;')
  && !indexHtml.includes('<script>alert(1)</script>')) {
  pass('renderArchiveIndex escapes HTML in the without-transcripts prep list and lists it');
} else fail('renderArchiveIndex without-transcripts list missing or unescaped');

const emptyHtml = renderArchiveIndex({ sessions: [], pastPrep: [] });
if (emptyHtml.includes('<p class="eyebrow">No archived interviews yet</p>')) {
  pass('renderArchiveIndex renders the empty state');
} else fail(`empty index html=${emptyHtml}`);

// --- renderArchiveSession ---------------------------------------------------

const richSession = {
  slug: 'rich-session',
  company: '<img src=x onerror=alert(1)>',
  role: 'Software Development Engineer in Test',
  round: 'system-design',
  date: '2026-02-01',
  interviewerRole: 'Panel Lead',
  source: 'debrief',
  turns: [
    {
      q: 'Tell me about a time <b>this</b> mattered.',
      competencies: ['ownership', 'communication'],
      a: 'Paragraph one with an unsafe tag <script>alert(2)</script>.\n\nParagraph two, still mine.',
    },
    { q: 'A plain follow-up question.', competencies: [], a: '' },
  ],
  candidateQuestions: ['What does success look like?'],
};
const sessionHtml = renderArchiveSession(richSession);

if (sessionHtml.includes('&lt;img src=x onerror=alert(1)&gt;')
  && !sessionHtml.includes('<img src=x onerror=alert(1)>')) {
  pass('renderArchiveSession escapes HTML in the company name');
} else fail('renderArchiveSession did not escape the company name');

if (sessionHtml.includes('&lt;script&gt;alert(2)&lt;/script&gt;')
  && !sessionHtml.includes('<script>alert(2)</script>')) {
  pass('renderArchiveSession escapes HTML embedded in an answer');
} else fail('renderArchiveSession did not escape answer content');

const paraCount = (sessionHtml.match(/Paragraph (one|two)/g) || []).length;
if (paraCount === 2 && sessionHtml.includes('<p>Paragraph one with an unsafe tag &lt;script&gt;alert(2)&lt;/script&gt;.</p>')
  && sessionHtml.includes('<p>Paragraph two, still mine.</p>')) {
  pass('renderArchiveSession renders a multi-paragraph answer as separate <p> elements');
} else fail('renderArchiveSession did not split the multi-paragraph answer correctly');

if (sessionHtml.includes('<span class="competency-chip">ownership</span>')
  && sessionHtml.includes('<span class="competency-chip">communication</span>')) {
  pass('renderArchiveSession renders competency chips for a tagged turn');
} else fail('renderArchiveSession missing competency chips');

if (sessionHtml.includes('No answer recorded')) {
  pass('renderArchiveSession renders a placeholder for an empty answer');
} else fail('renderArchiveSession missing empty-answer placeholder');

if (sessionHtml.includes('Questions you asked') && sessionHtml.includes('What does success look like?')) {
  pass('renderArchiveSession renders the candidate-questions section when present');
} else fail('renderArchiveSession missing Candidate Questions section');

if (sessionHtml.includes('System design')) {
  pass('renderArchiveSession renders a known round label');
} else fail('renderArchiveSession missing round label');

if (sessionHtml.includes('href="/archive"')) {
  pass('renderArchiveSession includes a back link to the archive index');
} else fail('renderArchiveSession missing back link to /archive');

const noQuestionsHtml = renderArchiveSession({
  ...richSession, candidateQuestions: [],
});
if (!noQuestionsHtml.includes('Questions you asked')) {
  pass('renderArchiveSession omits the candidate-questions section when empty');
} else fail('renderArchiveSession rendered an empty candidate-questions section');

// --- route wiring ------------------------------------------------------------

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
  const finished = new Promise((resolveResponse, rejectResponse) => {
    response.once('finish', resolveResponse);
    response.once('error', rejectResponse);
  });
  await entry.handler({}, response, url);
  if (!response.writableFinished) await finished;
  return { status: response.status, text: Buffer.concat(chunks).toString('utf8') };
}

let r = await requestRoute(FIX, '/archive');
if (r.status === 200 && r.text.includes('Interview archive')
  && r.text.includes('Acme Robotics')) {
  pass('GET /archive renders the index with fixture sessions');
} else fail(`GET /archive status=${r.status}`);

r = await requestRoute(FIX, '/archive/acme-firmware-hiring-manager-2026-01-10');
if (r.status === 200 && r.text.includes('Acme Robotics')
  && r.text.includes('Tell me about yourself.')) {
  pass('GET /archive/:slug renders a known session');
} else fail(`GET /archive/:slug status=${r.status}`);

r = await requestRoute(FIX, '/archive/does-not-exist');
if (r.status === 404) pass('GET /archive/:slug 404s for an unknown session');
else fail(`unknown session status=${r.status}`);

r = await requestRoute(FIX, '/archive/..%2F..%2Fetc%2Fpasswd');
if (r.status === 404) pass('GET /archive/:slug rejects a traversal slug');
else fail(`traversal slug status=${r.status}`);
