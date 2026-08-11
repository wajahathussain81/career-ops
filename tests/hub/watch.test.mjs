import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — live updates');
const FIX = join(ROOT, 'tests/hub/fixtures');
const tempRoot = mkdtempSync(join(tmpdir(), 'career-ops-hub-watch-'));
cpSync(FIX, tempRoot, { recursive: true });

const { watchPaths } = await import(pathToFileURL(join(ROOT, 'hub/lib/watch.mjs')).href);
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
let resolveConflict;
const changed = new Promise(resolve => { resolveChange = resolve; });
const conflicted = new Promise(resolve => { resolveConflict = resolve; });
const watcher = watchPaths(tempRoot, ['data'], {
  onChange: resolveChange,
  onConflict: resolveConflict,
});

let srv;
let controller;
let reader;
try {
  appendFileSync(join(tempRoot, 'data/status-log.tsv'), '\n');
  const changedPaths = await within(changed, 2000, 'watch change');
  if (changedPaths.some(file => file.includes('status-log'))) {
    pass('watcher reports changed status-log path');
  } else fail(`watcher paths=${JSON.stringify(changedPaths)}`);

  const conflictPath = join(tempRoot, 'data/applications.sync-conflict-x.md');
  writeFileSync(conflictPath, '# conflict\n');
  const conflictPaths = await within(conflicted, 2000, 'watch conflict');
  if (conflictPaths.some(file => file.includes('applications.sync-conflict-x.md'))) {
    pass('watcher reports new sync conflict');
  } else fail(`conflict paths=${JSON.stringify(conflictPaths)}`);

  watcher.close();
  srv = createServer({ root: tempRoot, token: 'test-token' });
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', resolve);
  });

  controller = new AbortController();
  const response = await within(fetch(
    `http://127.0.0.1:${srv.address().port}/api/events`,
    {
      headers: { cookie: `hub=${cookieValue('test-token')}` },
      signal: controller.signal,
    },
  ), 2000, 'SSE connect');
  reader = response.body.getReader();

  appendFileSync(join(tempRoot, 'data/status-log.tsv'), '\n');
  const decoder = new TextDecoder();
  let frame = '';
  const deadline = Date.now() + 3000;
  while (!frame.includes('event: data-changed') && Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const { value, done } = await within(reader.read(), remaining, 'SSE data-changed frame');
    if (done) break;
    frame += decoder.decode(value, { stream: true });
  }

  if (response.status === 200
    && response.headers.get('content-type')?.startsWith('text/event-stream')
    && frame.includes('event: data-changed')
    && frame.includes('status-log')) {
    pass('SSE streams data-changed frame');
  } else fail(`SSE status=${response.status} frame=${JSON.stringify(frame)}`);
} finally {
  watcher.close();
  controller?.abort();
  await reader?.cancel().catch(() => {});
  if (srv) await new Promise(resolve => srv.close(() => resolve()));
  rmSync(tempRoot, { recursive: true, force: true });
}
