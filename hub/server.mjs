import { createServer as createHttpServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { cookieValue, isAuthed, setAuthCookie } from './lib/auth.mjs';
import {
  getApplication,
  invalidate,
  listPackages,
  listPrepDirs,
  listSessions,
  loadApplications,
  loadPipelineCount,
  loadPrepPage,
  loadStatusLog,
  loadUnifiedContacts,
  resolveCover,
  sessionMatchesPrepSlug,
} from './lib/data.mjs';
import { computeFunnel } from './lib/funnel.mjs';
import { withLock } from './lib/lock.mjs';
import { getFollowupCadence } from './lib/scripts.mjs';
import { startRun } from './lib/agent.mjs';
import { getConflicts, watchPaths } from './lib/watch.mjs';
import { loadPrepNotes, loadPrepQa } from './gen-prep.mjs';
import { layout, escapeHtml } from './views/layout.mjs';
import { login } from './views/login.mjs';
import { loadStateLabels, renderApps } from './views/apps.mjs';
import { renderApplicationDetail } from './views/appdetail.mjs';
import { renderContacts } from './views/contacts.mjs';
import { renderOverview } from './views/overview.mjs';
import { renderPackages } from './views/packages.mjs';
import { renderPrepIndex, renderPrepSingle } from './views/prep.mjs';
import { renderArchiveIndex, renderArchiveSession } from './views/archive.mjs';
import { renderChat } from './views/chat.mjs';

const HUB_DIR = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(HUB_DIR, 'assets');
const REPO_ROOT = resolve(HUB_DIR, '..');
const BODY_LIMIT = 64 * 1024;
const MAX_SSE_CLIENTS = 24;
const APP_SORT_KEYS = new Set(['num', 'date', 'company', 'role', 'score', 'status']);
const appSortCollator = new Intl.Collator(undefined, { sensitivity: 'base' });
const assetVersion = Math.floor(Math.max(0, ...readdirSync(ASSETS_DIR, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => statSync(join(ASSETS_DIR, entry.name)).mtimeMs))).toString(36);

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

function send(res, status, body, contentType = 'text/html; charset=utf-8', headers = {}) {
  const responseHeaders = {
    'Content-Type': contentType,
    ...headers,
    'X-Content-Type-Options': 'nosniff',
  };
  if (contentType.startsWith('text/html')) responseHeaders['Cache-Control'] = 'no-store';
  res.writeHead(status, responseHeaders);
  res.end(body);
}

function sendJson(res, value, status = 200) {
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8', {
    'Cache-Control': 'private, no-store',
  });
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'X-Content-Type-Options': 'nosniff' });
  res.end();
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        rejectBody(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

function tokenMatches(actual, expected) {
  if (!actual || !expected) return false;
  const actualHash = Buffer.from(cookieValue(actual), 'hex');
  const expectedHash = Buffer.from(cookieValue(expected), 'hex');
  return timingSafeEqual(actualHash, expectedHash);
}

function sameOriginOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function hasJsonContentType(req) {
  return String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json');
}

function renderPage(options) {
  return layout({ ...options, assetVersion, banner: getConflicts() });
}

function errorPage(status, message) {
  const title = status === 404 ? 'Not found' : 'Server error';
  return renderPage({
    title,
    body: `<main class="hub-main"><p class="eyebrow">${status}</p><h1>${title}</h1><p>${escapeHtml(message)}</p></main>`,
  });
}

function routeMatches(pattern, pathname) {
  if (pattern.endsWith('*')) return pathname.startsWith(pattern.slice(0, -1));
  return pathname === pattern;
}

function localDate() {
  const tz = process.env.CAREER_OPS_TZ;
  if (tz) return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rejectedEver(apps, statusLog) {
  return new Set([
    ...apps.filter(app => app.status === 'Rejected').map(app => app.num),
    ...statusLog.filter(row => row.to === 'Rejected').map(row => row.num),
  ]).size;
}

function dueFollowups(cadence) {
  if (cadence?.__error) return cadence;
  const entries = Array.isArray(cadence) ? cadence : cadence?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter(item => item.urgency === 'urgent' || item.urgency === 'overdue');
}

function compareAppRows(a, b, sort, dir, statusRanks) {
  const direction = dir === 'desc' ? -1 : 1;
  let result = 0;

  if (sort === 'num') result = Number(a.num) - Number(b.num);
  else if (sort === 'date') result = String(a.date ?? '').localeCompare(String(b.date ?? ''));
  else if (sort === 'company' || sort === 'role') {
    result = appSortCollator.compare(String(a[sort] ?? ''), String(b[sort] ?? ''));
  } else if (sort === 'score') {
    const aScore = Number.parseFloat(a.score);
    const bScore = Number.parseFloat(b.score);
    const aNumeric = Number.isFinite(aScore);
    const bNumeric = Number.isFinite(bScore);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    if (aNumeric) result = aScore - bScore;
  } else if (sort === 'status') {
    const aRank = statusRanks.get(String(a.status ?? '').toLocaleLowerCase());
    const bRank = statusRanks.get(String(b.status ?? '').toLocaleLowerCase());
    const aKnown = aRank !== undefined;
    const bKnown = bRank !== undefined;
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    result = aKnown
      ? aRank - bRank
      : appSortCollator.compare(String(a.status ?? ''), String(b.status ?? ''));
  }

  return result ? result * direction : Number(a.num) - Number(b.num);
}

export function applicationsData(root, searchParams, statuses = loadStateLabels(root)) {
  const status = searchParams.get('status') || '';
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const minScoreRaw = searchParams.get('minScore');
  const minScore = minScoreRaw === null || minScoreRaw === '' ? null : Number(minScoreRaw);
  const requestedSort = searchParams.get('sort') || '';
  const sort = APP_SORT_KEYS.has(requestedSort) ? requestedSort : '';
  const dir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  const statusRanks = new Map(statuses.map((label, index) => [label.toLocaleLowerCase(), index]));
  const rows = loadApplications(root).filter(row => {
    if (status && row.status !== status) return false;
    if (q && !`${row.company} ${row.role} ${row.notes ?? ''}`.toLowerCase().includes(q)) return false;
    const score = Number.parseFloat(row.score);
    if (Number.isFinite(minScore) && (!Number.isFinite(score) || score < minScore)) return false;
    return true;
  });
  if (sort) rows.sort((a, b) => compareAppRows(a, b, sort, dir, statusRanks));
  return { rows, total: rows.length, sort, dir };
}

function prepEntry(root, entry) {
  const page = loadPrepPage(root, entry.slug);
  const application = page ? getApplication(root, page.meta?.tracker) : null;
  return {
    slug: entry.slug,
    page,
    qa: loadPrepQa(root, entry.slug, page?.meta),
    notes: loadPrepNotes(root, entry.slug),
    jdFile: application?.jdFile ?? entry.jdPath,
    resumeUrl: entry.resumePath
      ? `/files/prep-resume/${encodeURIComponent(entry.slug)}`
      : application?.resume?.exists
        ? `/files/resume/${encodeURIComponent(page.meta.tracker)}`
        : null,
  };
}

async function prepMutationDir(root, slug) {
  if (typeof slug !== 'string' || !slug || slug !== slug.trim()
    || isAbsolute(slug) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(slug)) {
    return { status: 400, error: 'invalid slug' };
  }

  const prepRoot = resolve(root, 'interview-prep');
  const candidate = resolve(prepRoot, slug);
  const rel = relative(prepRoot, candidate);
  if (!rel || rel.startsWith(`..${sep}`) || candidate === prepRoot
    || !candidate.startsWith(`${prepRoot}${sep}`)) {
    return { status: 400, error: 'invalid slug' };
  }

  try {
    const candidateStat = await stat(candidate);
    if (!candidateStat.isDirectory()) return { status: 404, error: 'unknown slug' };
    const [realPrepRoot, realCandidate] = await Promise.all([realpath(prepRoot), realpath(candidate)]);
    if (!realCandidate.startsWith(`${realPrepRoot}${sep}`)) {
      return { status: 400, error: 'invalid slug' };
    }
    return { dir: realCandidate };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { status: 404, error: 'unknown slug' };
    }
    throw error;
  }
}

async function readJsonRequest(req, res) {
  if (!sameOriginOk(req)) {
    sendJson(res, { ok: false, error: 'bad origin' }, 403);
    return null;
  }
  if (!hasJsonContentType(req)) {
    sendJson(res, { ok: false, error: 'unsupported content type' }, 415);
    return null;
  }
  const rawBody = await readBody(req);
  try {
    return JSON.parse(rawBody);
  } catch {
    sendJson(res, { ok: false, error: 'invalid json' }, 400);
    return null;
  }
}

async function atomicWrite(filePath, contents) {
  const tempPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, contents, 'utf8');
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

function dumpPrepQa(qa) {
  return yaml.dump(qa, {
    schema: yaml.JSON_SCHEMA,
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  });
}

function generatedQuestionId(qa, question) {
  const stem = String(question).toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'question';
  const ids = new Set((Array.isArray(qa?.sections) ? qa.sections : [])
    .flatMap(section => Array.isArray(section?.questions) ? section.questions : [])
    .map(item => String(item?.id ?? ''))
    .filter(Boolean));
  let id = `user-${stem}`;
  let suffix = 2;
  while (ids.has(id)) id = `user-${stem}-${suffix++}`;
  return id;
}

function prepEntries(root) {
  return listPrepDirs(root)
    .filter(entry => entry.hasPageYml)
    .map(entry => prepEntry(root, entry))
    .filter(entry => entry.page && Number.isFinite(Date.parse(entry.page.meta?.datetime)))
    .sort((a, b) => Date.parse(a.page.meta.datetime) - Date.parse(b.page.meta.datetime));
}

function setStatus(root, { num, state, note }) {
  return withLock(() => new Promise(resolveRun => {
    const args = ['set-status.mjs', '--row', String(num), state, ...(note ? ['--note', note] : [])];
    execFile('node', args, { cwd: root }, (error, _stdout, stderr) => {
      resolveRun({ ok: !error, stderr });
    });
  }));
}

function startChat(app, { prompt, worker }) {
  if (app.chatBusy) return false;
  app.chatBusy = true;

  try {
    app.chatRun = startRun({
      root: app.root,
      prompt,
      worker,
      workerCmd: app.workerCmd,
      logDir: app.logDir,
      onEvent: event => app.broadcast('chat', event),
      onExit: code => {
        app.broadcast('chat-exit', { code });
        app.chatRun = null;
        app.chatBusy = false;
      },
    });
  } catch (error) {
    app.chatRun = null;
    app.chatBusy = false;
    app.broadcast('chat-exit', { code: null, error: error.message });
  }
  return true;
}

async function overviewData(root) {
  const apps = loadApplications(root);
  const statusLog = loadStatusLog(root);
  const prep = prepEntries(root);
  const futurePrep = prep.filter(entry => Date.parse(entry.page.meta.datetime) > Date.now());
  const funnel = computeFunnel({ apps, statusLog, today: localDate() });
  funnel.ever.rejected = rejectedEver(apps, statusLog);

  return {
    funnel,
    quotaToday: funnel.quotaToday,
    inbox: loadPipelineCount(root),
    followupsDue: dueFollowups(await getFollowupCadence(root)),
    upcoming: prep.length ? futurePrep.map(({ slug, page }) => ({
      slug,
      num: page.meta.tracker,
      company: page.meta.company,
      role: page.meta.role,
      datetime: page.meta.datetime,
    })) : apps
      .filter(app => app.status === 'Interview')
      .map(({ num, company, role }) => ({ num, company, role })),
    recent: [...statusLog].reverse(),
  };
}

async function serveAsset(_app, req, res, url) {
  let assetName;
  try {
    assetName = decodeURIComponent(url.pathname.slice('/assets/'.length));
  } catch {
    send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
    return;
  }

  if (!assetName || assetName.includes('\0')) {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }

  const assetPath = resolve(ASSETS_DIR, assetName);
  const withinAssets = assetPath.startsWith(`${ASSETS_DIR}${sep}`)
    && !relative(ASSETS_DIR, assetPath).startsWith(`..${sep}`);
  if (!withinAssets) {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }

  try {
    const [contents, fileStat] = await Promise.all([readFile(assetPath), stat(assetPath)]);
    send(
      res,
      200,
      contents,
      CONTENT_TYPES.get(extname(assetPath).toLowerCase()) || 'application/octet-stream',
      {
        'Cache-Control': url.searchParams.has('v')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        'Last-Modified': fileStat.mtime.toUTCString(),
      },
    );
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }
    throw error;
  }
}

function serveEvents(app, _req, res) {
  if (app.eventClients.size >= MAX_SSE_CLIENTS) {
    send(res, 503, 'Too many SSE clients', 'text/plain; charset=utf-8');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  });
  res.flushHeaders?.();
  app.eventClients.add(res);

  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write(': ping\n\n');
  }, 25_000);
  heartbeat.unref();

  const cleanup = () => {
    clearInterval(heartbeat);
    app.eventClients.delete(res);
    app.backpressuredClients?.delete(res);
  };
  res.once('close', cleanup);
  res.once('error', cleanup);
}

export function route(app) {
  return [
    {
      method: 'GET',
      pattern: '/login',
      handler: async (_req, res) => send(res, 200, login()),
    },
    {
      method: 'POST',
      pattern: '/login',
      handler: async (req, res) => {
        const form = new URLSearchParams(await readBody(req));
        if (!tokenMatches(form.get('token'), app.token)) {
          send(res, 401, login({ error: 'The token was not accepted.' }));
          return;
        }
        setAuthCookie(res, app.token, { secure: app.cookieSecure });
        redirect(res, '/');
      },
    },
    {
      method: 'GET',
      pattern: '/assets/*',
      handler: (req, res, url) => serveAsset(app, req, res, url),
    },
    {
      method: 'GET',
      pattern: '/api/events',
      handler: (req, res) => serveEvents(app, req, res),
    },
    {
      method: 'GET',
      pattern: '/',
      handler: async (_req, res) => {
        const data = await overviewData(app.root);
        send(res, 200, renderPage({
          title: 'Overview',
          active: '/',
          body: renderOverview(data),
        }));
      },
    },
    {
      method: 'GET',
      pattern: '/api/overview',
      handler: async (_req, res) => sendJson(res, await overviewData(app.root)),
    },
    {
      method: 'GET',
      pattern: '/apps',
      handler: async (_req, res, url) => {
        const statuses = loadStateLabels(app.root);
        const data = applicationsData(app.root, url.searchParams, statuses);
        send(res, 200, renderPage({
          title: 'Applications',
          active: '/apps',
          body: renderApps({
            ...data,
            statuses,
            filters: Object.fromEntries(url.searchParams),
          }),
        }));
      },
    },
    {
      method: 'GET',
      pattern: '/apps/*',
      handler: async (_req, res, url) => {
        const num = url.pathname.slice('/apps/'.length);
        const detail = /^\d+$/.test(num) ? getApplication(app.root, num) : null;
        if (!detail) {
          send(res, 404, errorPage(404, 'The requested application does not exist.'));
          return;
        }
        send(res, 200, renderPage({
          title: `${detail.app.company} — ${detail.app.role}`,
          active: '/apps',
          body: renderApplicationDetail({
            ...detail,
            statuses: loadStateLabels(app.root),
          }),
        }));
      },
    },
    {
      method: 'GET',
      pattern: '/packages',
      handler: async (_req, res) => send(res, 200, renderPage({
        title: 'Packages',
        active: '/packages',
        body: renderPackages(listPackages(app.root)),
      })),
    },
    {
      method: 'GET',
      pattern: '/contacts',
      handler: async (_req, res) => send(res, 200, renderPage({
        title: 'Contacts',
        active: '/contacts',
        body: renderContacts(loadUnifiedContacts(app.root)),
      })),
    },
    {
      method: 'GET',
      pattern: '/prep',
      handler: async (_req, res) => {
        const entries = prepEntries(app.root);
        const now = Date.now();
        send(res, 200, renderPage({
          title: 'Interview prep',
          active: '/prep',
          body: renderPrepIndex({
            future: entries.filter(entry => Date.parse(entry.page.meta.datetime) > now),
            archive: entries.filter(entry => Date.parse(entry.page.meta.datetime) <= now).reverse(),
          }),
        }));
      },
    },
    {
      method: 'GET',
      pattern: '/prep/*',
      handler: async (_req, res, url) => {
        let slug;
        try {
          slug = decodeURIComponent(url.pathname.slice('/prep/'.length));
        } catch {
          slug = '';
        }
        const prepDir = listPrepDirs(app.root)
          .find(item => item.hasPageYml && item.slug === slug);
        const entry = prepDir ? prepEntry(app.root, prepDir) : null;
        if (!entry?.page) {
          send(res, 404, errorPage(404, 'The requested prep page does not exist.'));
          return;
        }
        send(res, 200, renderPage({
          title: `${entry.page.meta.company} — ${entry.page.meta.role}`,
          active: '/prep',
          body: renderPrepSingle(entry),
        }));
      },
    },
    {
      method: 'GET',
      pattern: '/archive',
      handler: async (_req, res) => {
        const sessions = listSessions(app.root);
        const now = Date.now();
        const pastPrep = prepEntries(app.root)
          .filter(entry => Date.parse(entry.page.meta.datetime) <= now)
          .map(entry => ({
            slug: entry.slug,
            company: entry.page.meta.company,
            role: entry.page.meta.role,
            datetime: entry.page.meta.datetime,
            hasTranscript: sessions.some(session => sessionMatchesPrepSlug(session.company, entry.slug)),
          }));
        send(res, 200, renderPage({
          title: 'Archive',
          active: '/archive',
          body: renderArchiveIndex({ sessions, pastPrep }),
        }));
      },
    },
    {
      method: 'GET',
      pattern: '/archive/*',
      handler: async (_req, res, url) => {
        let slug;
        try {
          slug = decodeURIComponent(url.pathname.slice('/archive/'.length));
        } catch {
          slug = '';
        }
        const session = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(slug)
          ? listSessions(app.root).find(item => item.slug === slug)
          : null;
        if (!session) {
          send(res, 404, errorPage(404, 'The requested session does not exist.'));
          return;
        }
        send(res, 200, renderPage({
          title: `${session.company} — ${session.role}`,
          active: '/archive',
          body: renderArchiveSession(session),
        }));
      },
    },
    {
      method: 'POST',
      pattern: '/api/prep/answer',
      handler: async (req, res) => {
        const body = await readJsonRequest(req, res);
        if (!body) return;
        if (typeof body.slug !== 'string' || typeof body.id !== 'string'
          || !body.id || typeof body.answer !== 'string') {
          sendJson(res, { ok: false, error: 'invalid fields' }, 400);
          return;
        }
        const workspace = await prepMutationDir(app.root, body.slug);
        if (!workspace.dir) {
          sendJson(res, { ok: false, error: workspace.error }, workspace.status);
          return;
        }
        const page = loadPrepPage(app.root, body.slug);
        const qa = loadPrepQa(app.root, body.slug, page?.meta);
        let match = null;
        for (const section of qa.sections) {
          if (!Array.isArray(section?.questions)) continue;
          match = section.questions.find(question => String(question?.id ?? '') === body.id);
          if (match) break;
        }
        if (!match) {
          sendJson(res, { ok: false, error: 'unknown question' }, 404);
          return;
        }
        match.answer = body.answer;
        await atomicWrite(join(workspace.dir, 'qa.yml'), dumpPrepQa(qa));
        sendJson(res, { ok: true, id: body.id });
      },
    },
    {
      method: 'POST',
      pattern: '/api/prep/question',
      handler: async (req, res) => {
        const body = await readJsonRequest(req, res);
        if (!body) return;
        const sectionTitle = typeof body.section === 'string' ? body.section.trim() : '';
        const questionText = typeof body.q === 'string' ? body.q.trim() : '';
        if (typeof body.slug !== 'string' || !sectionTitle || !questionText) {
          sendJson(res, { ok: false, error: 'invalid fields' }, 400);
          return;
        }
        const workspace = await prepMutationDir(app.root, body.slug);
        if (!workspace.dir) {
          sendJson(res, { ok: false, error: workspace.error }, workspace.status);
          return;
        }
        const page = loadPrepPage(app.root, body.slug);
        const qa = loadPrepQa(app.root, body.slug, page?.meta);
        if (!Array.isArray(qa.sections)) qa.sections = [];
        let section = qa.sections.find(item => item && typeof item === 'object'
          && !Array.isArray(item) && String(item.title ?? '') === sectionTitle);
        if (!section) {
          section = { title: sectionTitle, questions: [] };
          qa.sections.push(section);
        } else if (!Array.isArray(section.questions)) section.questions = [];
        const question = {
          id: generatedQuestionId(qa, questionText),
          q: questionText,
          source: 'user',
          answer: '',
        };
        section.questions.push(question);
        await atomicWrite(join(workspace.dir, 'qa.yml'), dumpPrepQa(qa));
        sendJson(res, { ok: true, id: question.id, question, section: sectionTitle });
      },
    },
    {
      method: 'POST',
      pattern: '/api/prep/notes',
      handler: async (req, res) => {
        const body = await readJsonRequest(req, res);
        if (!body) return;
        if (typeof body.slug !== 'string' || typeof body.notes !== 'string') {
          sendJson(res, { ok: false, error: 'invalid fields' }, 400);
          return;
        }
        const workspace = await prepMutationDir(app.root, body.slug);
        if (!workspace.dir) {
          sendJson(res, { ok: false, error: workspace.error }, workspace.status);
          return;
        }
        await atomicWrite(join(workspace.dir, 'notes.md'), body.notes);
        sendJson(res, { ok: true });
      },
    },
    {
      method: 'GET',
      pattern: '/chat',
      handler: async (_req, res) => send(res, 200, renderPage({
        title: 'Chat',
        active: '/chat',
        body: renderChat(),
      })),
    },
    {
      method: 'GET',
      pattern: '/api/apps',
      handler: async (_req, res, url) => {
        const statuses = loadStateLabels(app.root);
        sendJson(res, applicationsData(app.root, url.searchParams, statuses));
      },
    },
    {
      method: 'POST',
      pattern: '/api/status',
      handler: async (req, res) => {
        if (!sameOriginOk(req)) {
          sendJson(res, { ok: false, error: 'bad origin' }, 403);
          return;
        }
        if (!hasJsonContentType(req)) {
          sendJson(res, { ok: false, error: 'unsupported content type' }, 415);
          return;
        }
        const rawBody = await readBody(req);
        let body;
        try {
          body = JSON.parse(rawBody);
        } catch {
          sendJson(res, { ok: false, error: 'invalid json' }, 400);
          return;
        }
        if (!body.num || !body.state) {
          sendJson(res, { ok: false, error: 'missing fields' }, 400);
          return;
        }
        const result = await setStatus(app.root, body);
        if (!result.ok) {
          sendJson(res, { ok: false, stderr: result.stderr }, 422);
          return;
        }
        sendJson(res, { ok: true });
      },
    },
    {
      method: 'GET',
      pattern: '/api/chat/status',
      handler: async (_req, res) => sendJson(res, { running: Boolean(app.chatBusy) }),
    },
    {
      method: 'POST',
      pattern: '/api/chat',
      handler: async (req, res) => {
        if (!sameOriginOk(req)) {
          sendJson(res, { ok: false, error: 'bad origin' }, 403);
          return;
        }
        if (!hasJsonContentType(req)) {
          sendJson(res, { ok: false, error: 'unsupported content type' }, 415);
          return;
        }
        const rawBody = await readBody(req);
        let body;
        try {
          body = JSON.parse(rawBody);
        } catch {
          sendJson(res, { ok: false, error: 'invalid json' }, 400);
          return;
        }
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        if (!prompt) {
          sendJson(res, { error: 'missing prompt' }, 400);
          return;
        }
        if (!startChat(app, { prompt, worker: body.worker || 'codex' })) {
          sendJson(res, { error: 'busy' }, 409);
          return;
        }
        sendJson(res, { ok: true }, 202);
      },
    },
    {
      method: 'POST',
      pattern: '/api/chat/kill',
      handler: async (req, res) => {
        if (!sameOriginOk(req)) {
          sendJson(res, { ok: false, error: 'bad origin' }, 403);
          return;
        }
        app.chatRun?.kill();
        sendJson(res, { ok: true });
      },
    },
    {
      method: 'GET',
      pattern: '/files/prep-resume/*',
      handler: async (_req, res, url) => {
        let slug;
        try {
          slug = decodeURIComponent(url.pathname.slice('/files/prep-resume/'.length));
        } catch {
          slug = '';
        }
        const prep = listPrepDirs(app.root).find(entry => entry.slug === slug);
        if (!prep?.resumePath) {
          send(res, 404, errorPage(404, 'The requested resume is not available.'));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        const stream = createReadStream(prep.resumePath);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
      },
    },
    {
      method: 'GET',
      pattern: '/files/resume/*',
      handler: async (_req, res, url) => {
        const num = url.pathname.slice('/files/resume/'.length);
        const detail = /^\d+$/.test(num) ? getApplication(app.root, num) : null;
        if (!detail?.resume?.exists) {
          send(res, 404, errorPage(404, 'The requested resume is not available.'));
          return;
        }
        const root = resolve(app.root);
        const resumePath = resolve(root, detail.resume.path);
        if (!resumePath.startsWith(`${root}${sep}`)) {
          send(res, 404, errorPage(404, 'The requested resume is not available.'));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        const stream = createReadStream(resumePath);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
      },
    },
    {
      method: 'GET',
      pattern: '/files/cover/*',
      handler: async (_req, res, url) => {
        const num = url.pathname.slice('/files/cover/'.length);
        const cover = /^\d+$/.test(num) ? resolveCover(app.root, num) : null;
        if (!cover?.exists) {
          send(res, 404, errorPage(404, 'The requested cover letter is not available.'));
          return;
        }
        const root = resolve(app.root);
        const coverPath = resolve(root, cover.path);
        if (!coverPath.startsWith(`${root}${sep}`)) {
          send(res, 404, errorPage(404, 'The requested cover letter is not available.'));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        const stream = createReadStream(coverPath);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
      },
    },
  ];
}

function isPublic(method, pathname) {
  return (pathname === '/login' && (method === 'GET' || method === 'POST'))
    || (method === 'GET' && pathname.startsWith('/assets/'));
}

export function createServer(opts = {}) {
  const {
    root = REPO_ROOT,
    token,
    logDir,
    cookieSecure = false,
  } = opts;
  const configuredWorkerCmd = opts.workerCmd ?? process.env.HUB_WORKER_CMD;
  const workerCmd = Array.isArray(configuredWorkerCmd)
    ? configuredWorkerCmd
    : configuredWorkerCmd?.trim().split(/\s+/).filter(Boolean);
  const shouldWatch = opts.watch !== false;
  const eventClients = new Set();
  const backpressuredClients = new WeakSet();
  const broadcast = (event, data) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of eventClients) {
      if (client.destroyed) eventClients.delete(client);
      else if (!backpressuredClients.has(client) && !client.write(frame)) {
        backpressuredClients.add(client);
        client.once('drain', () => backpressuredClients.delete(client));
      }
    }
  };
  const app = {
    root,
    token,
    cookieSecure,
    workerCmd,
    logDir,
    eventClients,
    backpressuredClients,
    broadcast,
    chatBusy: false,
    chatRun: null,
  };
  const routes = route(app);

  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://hub.local');
      const method = req.method || 'GET';

      if (!isPublic(method, url.pathname) && !isAuthed(req, app.token)) {
        redirect(res, '/login');
        return;
      }

      const matched = routes.find((entry) => entry.method === method
        && routeMatches(entry.pattern, url.pathname));
      if (!matched) {
        send(res, 404, errorPage(404, 'The requested page does not exist.'));
        return;
      }

      await matched.handler(req, res, url);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      send(res, status, errorPage(status, error?.message || 'Unexpected server error.'));
    }
  });

  const pathWatcher = shouldWatch
    ? watchPaths(root, ['data', 'reports', 'interview-prep', 'jds'], {
      watchImpl: opts.watchImpl,
      onChange(paths) {
        invalidate();
        broadcast('data-changed', { paths });
      },
      onConflict() {
        broadcast('conflict', { files: getConflicts() });
      },
    })
    : null;
  server.once('close', () => pathWatcher?.close());
  server.hubBroadcast = broadcast;
  return server;
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  const token = process.env.HUB_TOKEN;
  if (!token || token === 'change-me') {
    console.error('HUB_TOKEN is required and must not be "change-me".');
    process.exitCode = 1;
  } else {
    const port = Number.parseInt(process.env.HUB_PORT || '8484', 10);
    const host = process.env.HUB_HOST || '127.0.0.1';
    const root = process.env.HUB_ROOT || REPO_ROOT;
    const workerCmd = process.env.HUB_WORKER_CMD;
    const cookieSecure = Boolean(process.env.HUB_COOKIE_SECURE);
    createServer({ root, token, workerCmd, cookieSecure }).listen(port, host, () => {
      console.log(`Career Ops Hub listening on http://${host}:${port}`);
    });
  }
}
