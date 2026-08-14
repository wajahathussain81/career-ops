import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — live updates');
const FIX = join(ROOT, 'tests/hub/fixtures');
const tempRoot = mkdtempSync(join(tmpdir(), 'career-ops-hub-watch-'));
cpSync(FIX, tempRoot, { recursive: true });

const { getConflicts, watchPaths } = await import(pathToFileURL(join(ROOT, 'hub/lib/watch.mjs')).href);
const { createServer } = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);
const { cookieValue } = await import(pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href);

function within(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

let resolveChange;
const changed = new Promise(resolve => { resolveChange = resolve; });
const startupConflict = 'data/nested/preexisting.sync-conflict.md';
const liveConflict = 'data/applications.sync-conflict-x.md';
mkdirSync(join(tempRoot, 'data/nested'), { recursive: true });
writeFileSync(join(tempRoot, startupConflict), '# startup conflict\n');

let resolveLiveConflict;
let resolvePrunedConflict;
let awaitingPrune = false;
const conflicted = new Promise(resolve => { resolveLiveConflict = resolve; });
const pruned = new Promise(resolve => { resolvePrunedConflict = resolve; });
const conflictNotifications = [];
const fakeWatchers = [];
function watchImpl(absPath, _options, listener) {
  const fsWatcher = new EventEmitter();
  fsWatcher.close = () => { fsWatcher.closed = true; };
  fakeWatchers.push({ absPath, listener, fsWatcher });
  return fsWatcher;
}
function emitWatch(relPath, filename) {
  const absPath = join(tempRoot, relPath);
  const target = [...fakeWatchers].reverse()
    .find(item => item.absPath === absPath && !item.fsWatcher.closed);
  target?.listener('change', filename);
}
const watcher = watchPaths(tempRoot, ['data'], {
  watchImpl,
  onChange: resolveChange,
  onConflict(files) {
    conflictNotifications.push(files);
    if (files.includes(liveConflict)) resolveLiveConflict(files);
    if (awaitingPrune && !files.includes(liveConflict)) resolvePrunedConflict(files);
  },
});

let srv;
let sseResponse;
try {
  if (getConflicts().includes(startupConflict)
    && conflictNotifications.some(files => files.includes(startupConflict))) {
    pass('watcher seeds pre-existing nested sync conflicts at startup');
  } else fail(`startup conflicts=${JSON.stringify(getConflicts())}`);

  appendFileSync(join(tempRoot, 'data/status-log.tsv'), '\n');
  emitWatch('data', 'status-log.tsv');
  const changedPaths = await within(changed, 2000, 'watch change');
  if (changedPaths.some(file => file.includes('status-log'))) {
    pass('watcher reports changed status-log path');
  } else fail(`watcher paths=${JSON.stringify(changedPaths)}`);

  const conflictPath = join(tempRoot, liveConflict);
  writeFileSync(conflictPath, '# conflict\n');
  emitWatch('data', 'applications.sync-conflict-x.md');
  const conflictPaths = await within(conflicted, 2000, 'watch conflict');
  if (conflictPaths.some(file => file.includes('applications.sync-conflict-x.md'))) {
    pass('watcher reports new sync conflict');
  } else fail(`conflict paths=${JSON.stringify(conflictPaths)}`);

  awaitingPrune = true;
  rmSync(conflictPath);
  emitWatch('data', 'applications.sync-conflict-x.md');
  const prunedPaths = await within(pruned, 2000, 'watch conflict prune');
  if (!prunedPaths.includes(liveConflict) && prunedPaths.includes(startupConflict)) {
    pass('watcher notifies with the full conflict list after pruning a deleted conflict');
  } else fail(`pruned conflict paths=${JSON.stringify(prunedPaths)}`);

  watcher.close();
  srv = createServer({ root: tempRoot, token: 'test-token', watchImpl });
  let responseStatus = 0;
  let responseHeaders = {};
  let frame = '';
  let resolveFrame;
  const frameReceived = new Promise(resolve => { resolveFrame = resolve; });
  const request = new EventEmitter();
  request.method = 'GET';
  request.url = '/api/events';
  request.headers = {
    cookie: `hub=${cookieValue('test-token')}`,
    host: 'hub.local',
  };
  sseResponse = new EventEmitter();
  sseResponse.destroyed = false;
  sseResponse.writeHead = (status, headers) => {
    responseStatus = status;
    responseHeaders = headers;
  };
  sseResponse.flushHeaders = () => {};
  sseResponse.write = chunk => {
    frame += String(chunk);
    if (frame.includes('event: data-changed')) resolveFrame();
    return true;
  };
  sseResponse.end = () => {};
  srv.emit('request', request, sseResponse);
  await new Promise(resolve => setImmediate(resolve));

  appendFileSync(join(tempRoot, 'data/status-log.tsv'), '\n');
  emitWatch('data', 'status-log.tsv');
  await within(frameReceived, 3000, 'SSE data-changed frame');

  if (responseStatus === 200
    && responseHeaders['Content-Type']?.startsWith('text/event-stream')
    && frame.includes('event: data-changed')
    && frame.includes('status-log')) {
    pass('SSE streams data-changed frame');
  } else fail(`SSE status=${responseStatus} frame=${JSON.stringify(frame)}`);
} finally {
  watcher.close();
  sseResponse?.emit('close');
  srv?.emit('close');
  rmSync(tempRoot, { recursive: true, force: true });
}
