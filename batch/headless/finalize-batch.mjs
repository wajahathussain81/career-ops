#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = process.cwd();
const WORKDIR = path.resolve(
  process.env.CAREER_OPS_WORKDIR
    || path.join(REPO, 'batch/headless/.headless-work'),
);
const TODAY = new Date().toISOString().slice(0, 10);
const manifest = JSON.parse(fs.readFileSync(path.join(WORKDIR, 'batch-manifest.json'), 'utf-8'));
const expiredFile = path.join(WORKDIR, 'expired-urls.txt');
const expired = new Set(
  fs.existsSync(expiredFile)
    ? fs.readFileSync(expiredFile, 'utf-8').split('\n').map(line => line.trim()).filter(Boolean)
    : [],
);

const results = {};
for (const m of manifest) {
  try {
    const line = fs.readFileSync(path.join(WORKDIR, `out-${m.num}.txt`), 'utf-8').trim().split('\n').pop();
    if (/\| SKIPPED \|/.test(line)) {
      const reason = line.split('|').slice(3).join('|').trim();
      results[m.num] = { kind: 'skip', reason, company: line.split('|')[2].trim() };
    } else {
      const parts = line.split('|').map(s => s.trim());
      results[m.num] = { kind: 'eval', company: parts[1], role: parts[2], score: (parts[3] || '').replace('/5', '') };
    }
  } catch {
    results[m.num] = { kind: 'missing' };
  }
}

// 1. discard.log for skips
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
let discardLines = '';
for (const m of manifest) {
  const r = results[m.num];
  if (r.kind === 'skip') discardLines += `${now}\t${m.url}\t${r.reason}\n`;
}
if (discardLines) fs.appendFileSync(path.join(REPO, 'data/discard.log'), discardLines);

// 2. release all sentinels
for (const m of manifest) {
  try {
    execFileSync('node', ['reserve-report-num.mjs', '--release', m.num], { cwd: REPO, stdio: 'pipe' });
  } catch {}
}

// 3. pipeline.md: move processed
const pipelineFile = path.join(REPO, 'data/pipeline.md');
const lines = fs.readFileSync(pipelineFile, 'utf-8').split('\n');
const kept = [];
const processed = [];
for (const line of lines) {
  if (!line.startsWith('- [ ]')) {
    kept.push(line);
    continue;
  }
  const match = line.match(/^- \[ \] (\S+)/);
  if (!match) {
    kept.push(line);
    continue;
  }
  const url = match[1];
  if (expired.has(url)) {
    processed.push(`- [x] ~~${url}~~ — posting expired (liveness sweep ${TODAY})`);
    continue;
  }
  const m = manifest.find(x => x.url === url);
  if (!m) {
    kept.push(line);
    continue;
  }
  const r = results[m.num];
  if (r.kind === 'skip') {
    processed.push(`- [x] #-- | ${url} | skipped (pre-screen mismatch: ${r.reason})`);
  } else if (r.kind === 'eval') {
    processed.push(`- [x] #${m.num} | ${url} | ${r.company} | ${r.role} | ${r.score}/5 | PDF ❌`);
  } else {
    kept.push(line);
  }
}
let out = kept.join('\n').trimEnd() + '\n';
if (processed.length) out += processed.join('\n') + '\n';
fs.writeFileSync(pipelineFile, out);

const evaluated = Object.values(results).filter(r => r.kind === 'eval').length;
const skipped = Object.values(results).filter(r => r.kind === 'skip').length;
const missing = Object.values(results).filter(r => r.kind === 'missing').length;
console.log(JSON.stringify({
  evaluated,
  skipped,
  missing,
  movedToProcessed: processed.length,
  pendingLeft: kept.filter(l => l.startsWith('- [ ]')).length,
}));
