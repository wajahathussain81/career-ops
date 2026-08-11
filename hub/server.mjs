import { createServer as createHttpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cookieValue, isAuthed, setAuthCookie } from './lib/auth.mjs';
import {
  getApplication,
  invalidate,
  listPrepDirs,
  loadApplications,
  loadContacts,
  loadPipelineCount,
  loadPrepPage,
  loadStatusLog,
} from './lib/data.mjs';
import { computeFunnel } from './lib/funnel.mjs';
import { withLock } from './lib/lock.mjs';
import { getFollowupCadence } from './lib/scripts.mjs';
import { startRun } from './lib/agent.mjs';
import { getConflicts, watchPaths } from './lib/watch.mjs';
import { layout, escapeHtml } from './views/layout.mjs';
import { login } from './views/login.mjs';
import { loadStateLabels, renderApps } from './views/apps.mjs';
import { renderApplicationDetail } from './views/appdetail.mjs';
import { renderContacts } from './views/contacts.mjs';
import { renderOverview } from './views/overview.mjs';
import { renderPrepIndex, renderPrepSingle } from './views/prep.mjs';
import { renderChat } from './views/chat.mjs';

const HUB_DIR = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(HUB_DIR, 'assets');
const REPO_ROOT = resolve(HUB_DIR, '..');
const BODY_LIMIT = 64 * 1024;

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

function send(res, status, body, contentType = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function sendJson(res, value, status = 200) {
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
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

function renderPage(options) {
  return layout({ ...options, banner: getConflicts() });
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

function applicationsData(root, searchParams) {
  const status = searchParams.get('status') || '';
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const minScoreRaw = searchParams.get('minScore');
  const minScore = minScoreRaw === null || minScoreRaw === '' ? null : Number(minScoreRaw);
  const rows = loadApplications(root).filter(row => {
    if (status && row.status !== status) return false;
    if (q && !`${row.company} ${row.role} ${row.notes ?? ''}`.toLowerCase().includes(q)) return false;
    const score = Number.parseFloat(row.score);
    if (Number.isFinite(minScore) && (!Number.isFinite(score) || score < minScore)) return false;
    return true;
  });
  return { rows, total: rows.length };
}

function prepEntries(root) {
  return listPrepDirs(root)
    .filter(entry => entry.hasPageYml)
    .map(entry => ({ slug: entry.slug, page: loadPrepPage(root, entry.slug) }))
    .filter(entry => entry.page && Number.isFinite(Date.parse(entry.page.meta?.datetime)))
    .sort((a, b) => Date.parse(a.page.meta.datetime) - Date.parse(b.page.meta.datetime));
}

function setStatus(root, { num, state, note }) {
  return withLock(() => new Promise(resolveRun => {
    const args = ['set-status.mjs', String(num), state, ...(note ? ['--note', note] : [])];
    execFile('node', args, { cwd: root }, (error, _stdout, stderr) => {
      resolveRun({ ok: !error, stderr });
    });
  }));
}

function startChat(app, { prompt, worker }) {
  if (app.chatBusy) return false;
  app.chatBusy = true;

  withLock(() => new Promise((resolveRun, rejectRun) => {
    try {
      app.chatRun = startRun({
        root: app.root,
        prompt,
        worker,
        workerCmd: app.workerCmd,
        logDir: app.logDir,
        onChunk: chunk => app.broadcast('chat', { chunk }),
        onExit: code => {
          app.broadcast('chat-exit', { code });
          app.chatRun = null;
          app.chatBusy = false;
          resolveRun();
        },
      });
    } catch (error) {
      app.chatRun = null;
      app.chatBusy = false;
      rejectRun(error);
    }
  })).catch(error => {
    app.broadcast('chat-exit', { code: null, error: error.message });
  });
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
    const contents = await readFile(assetPath);
    send(res, 200, contents, CONTENT_TYPES.get(extname(assetPath).toLowerCase()) || 'application/octet-stream');
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }
    throw error;
  }
}

function serveEvents(app, _req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
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
        setAuthCookie(res, app.token);
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
        const data = applicationsData(app.root, url.searchParams);
        send(res, 200, renderPage({
          title: 'Applications',
          active: '/apps',
          body: renderApps({
            ...data,
            statuses: loadStateLabels(app.root),
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
      pattern: '/contacts',
      handler: async (_req, res) => send(res, 200, renderPage({
        title: 'Contacts',
        active: '/contacts',
        body: renderContacts(loadContacts(app.root)),
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
        const page = loadPrepPage(app.root, slug);
        if (!page) {
          send(res, 404, errorPage(404, 'The requested prep page does not exist.'));
          return;
        }
        send(res, 200, renderPage({
          title: `${page.meta.company} — ${page.meta.role}`,
          active: '/prep',
          body: renderPrepSingle(page),
        }));
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
      handler: async (_req, res, url) => sendJson(res, applicationsData(app.root, url.searchParams)),
    },
    {
      method: 'POST',
      pattern: '/api/status',
      handler: async (req, res) => {
        const body = JSON.parse(await readBody(req));
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
      method: 'POST',
      pattern: '/api/chat',
      handler: async (req, res) => {
        const body = JSON.parse(await readBody(req));
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
      handler: async (_req, res) => {
        app.chatRun?.kill();
        sendJson(res, { ok: true });
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
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        const stream = createReadStream(resumePath);
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
  } = opts;
  const configuredWorkerCmd = opts.workerCmd ?? process.env.HUB_WORKER_CMD;
  const workerCmd = Array.isArray(configuredWorkerCmd)
    ? configuredWorkerCmd
    : configuredWorkerCmd?.trim().split(/\s+/).filter(Boolean);
  const shouldWatch = opts.watch !== false;
  const eventClients = new Set();
  const broadcast = (event, data) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of eventClients) {
      if (client.destroyed) eventClients.delete(client);
      else client.write(frame);
    }
  };
  const app = {
    root,
    token,
    workerCmd,
    logDir,
    eventClients,
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
  if (!token) {
    console.error('HUB_TOKEN is required.');
    process.exitCode = 1;
  } else {
    const port = Number.parseInt(process.env.HUB_PORT || '8484', 10);
    const root = process.env.HUB_ROOT || REPO_ROOT;
    const workerCmd = process.env.HUB_WORKER_CMD;
    createServer({ root, token, workerCmd }).listen(port, () => {
      console.log(`Career Ops Hub listening on http://0.0.0.0:${port}`);
    });
  }
}
