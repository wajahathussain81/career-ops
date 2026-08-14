#!/usr/bin/env node

// Phase B: assign report numbers to live URLs, fetch JDs, write Codex prompts.
// Usage: node batch/headless/prepare-batch.mjs <live-urls-file> <start-num>
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.cwd();
const WORKDIR = path.resolve(
  process.env.CAREER_OPS_WORKDIR
    || path.join(REPO, 'batch/headless/.headless-work'),
);
const [liveFile, startStr] = process.argv.slice(2);
const START = Number.parseInt(startStr, 10);
const TODAY = new Date().toISOString().slice(0, 10);

if (!liveFile || !Number.isSafeInteger(START) || START < 1) {
  console.error('Usage: node batch/headless/prepare-batch.mjs <live-urls-file> <start-num>');
  process.exit(1);
}

fs.mkdirSync(WORKDIR, { recursive: true });
fs.mkdirSync(path.join(REPO, 'jds'), { recursive: true });

const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const get = url => new Promise((res, rej) => {
  const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, r => {
    if (r.statusCode >= 301 && r.statusCode <= 308 && r.headers.location) { r.resume(); return get(new URL(r.headers.location, url).href).then(res, rej); }
    let d = ''; r.on('data', c => d += c); r.on('end', () => res({ code: r.statusCode, body: d }));
  });
  req.on('error', rej); req.setTimeout(20000, () => { req.destroy(new Error('timeout')); });
});

// pipeline rows: url | company | title | location | posted:...
const pipelineRows = fs.readFileSync(path.join(REPO, 'data/pipeline.md'), 'utf-8').split('\n')
  .filter(l => l.startsWith('- [ ]')).map(l => {
    const parts = l.replace(/^- \[ \] /, '').split(' | ');
    return { url: parts[0], company: parts[1] || '', title: parts[2] || '', location: (parts[3] || '').startsWith('posted:') ? '' : (parts[3] || '') };
  });

const liveUrls = fs.readFileSync(path.resolve(liveFile), 'utf-8').split('\n').map(s => s.trim()).filter(Boolean);
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'unknown';

const ashbyCache = {};
async function fetchJD(url) {
  let m;
  if ((m = url.match(/https:\/\/([^/]+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/(job\/.+)$/))) {
    const tenant = m[1].split('.')[0];
    const { body } = await get(`https://${m[1]}/wday/cxs/${tenant}/${m[2]}/${m[3]}`);
    const j = JSON.parse(body); const p = j.jobPostingInfo || {};
    return `TITLE: ${p.title}\nLOCATION: ${p.location || ''} ${p.additionalLocations || ''}\nPOSTED: ${p.startDate || ''}\n\n${strip(p.jobDescription || '')}`;
  }
  if ((m = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/))) {
    const { body } = await get(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`);
    const j = JSON.parse(body);
    return `TITLE: ${j.title}\nLOCATION: ${(j.location || {}).name || ''}\nUPDATED: ${j.updated_at}\n\n${strip(j.content || '')}`;
  }
  if ((m = url.match(/[?&]gh_jid=(\d+)/))) {
    // branded greenhouse front — board token guess from hostname
    const host = new URL(url).hostname; // e.g. jobs.elastic.co, careers.toasttab.com
    const guesses = host.split('.').slice(-2, -1).concat(host.split('.')[0].replace(/^(jobs|careers|www)$/, ''));
    for (const g of [...new Set(guesses.filter(Boolean))]) {
      try {
        const { code, body } = await get(`https://boards-api.greenhouse.io/v1/boards/${g}/jobs/${m[1]}`);
        if (code === 200) { const j = JSON.parse(body); return `TITLE: ${j.title}\nLOCATION: ${(j.location || {}).name || ''}\n\n${strip(j.content || '')}`; }
      } catch {}
    }
    throw new Error('gh_jid board not resolved');
  }
  if ((m = url.match(/jobs\.lever\.co\/([^/]+)\/([0-9a-f-]{36})/))) {
    const { body } = await get(`https://api.lever.co/v0/postings/${m[1]}/${m[2]}`);
    const j = JSON.parse(body);
    return `TITLE: ${j.text}\nLOCATION: ${(j.categories || {}).location || ''}\nWORKPLACE: ${j.workplaceType || ''}\n\n${strip(j.description || '')}\n\n` + (j.lists || []).map(l => l.text + '\n' + strip(l.content)).join('\n\n');
  }
  if ((m = url.match(/jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{36})/))) {
    if (!ashbyCache[m[1]]) {
      const { body } = await get(`https://api.ashbyhq.com/posting-api/job-board/${m[1]}?includeCompensation=true`);
      ashbyCache[m[1]] = JSON.parse(body);
    }
    const job = (ashbyCache[m[1]].jobs || []).find(x => x.id === m[2]);
    if (!job) throw new Error('ashby job id not in board');
    return `TITLE: ${job.title}\nLOCATION: ${job.location} | ${(job.secondaryLocations || []).map(l => l.location).join(', ')}\nCOMP: ${JSON.stringify(job.compensation || null)}\n\n${strip(job.descriptionHtml || '')}`;
  }
  throw new Error('no API recipe for URL');
}

const manifest = [];
let num = START;
for (const url of liveUrls) {
  const row = pipelineRows.find(r => r.url === url) || { company: '', title: '', location: '' };
  const n = String(num).padStart(3, '0');
  const slug = slugify(row.company || new URL(url).hostname.split('.')[0]) + (liveUrls.filter(u => (pipelineRows.find(r => r.url === u) || {}).company === row.company).length > 1 ? `-${n}` : '');
  for (const artifact of [`prompt-${n}.md`, `out-${n}.txt`, `codex-log-${n}.txt`]) {
    fs.rmSync(path.join(WORKDIR, artifact), { force: true });
  }
  try {
    const jd = await fetchJD(url);
    fs.writeFileSync(path.join(REPO, `jds/jd-${n}-${slug}.txt`), jd);
    const jobgetherVia = new URL(url).hostname === 'jobs.lever.co'
      && new URL(url).pathname.split('/').filter(Boolean)[0] === 'jobgether'
      ? `

JOBGETHER VIA-HANDLING: This posting is carried by Jobgether. Identify the real employer from the JD and use that employer as {Company}. Append a 10th TAB-separated TSV field exactly "via=Jobgether". If the real employer cannot be identified, use "?" as {Company} and still append "via=Jobgether".`
      : '';
    const prompt = `You are a single-pass job-evaluation worker for the career-ops system. The cwd is the career-ops repo root. You have NO network access — everything you need is in local files.

ASSIGNMENT: evaluate one job posting for the candidate.
- Report number: ${n} | Slug: ${slug}
- Company (from scanner): ${row.company || 'unknown — take it from the JD'}
- Posting URL (for the report header only, do not fetch): ${url}
- The full JD text is in: jds/jd-${n}-${slug}.txt
- Today's date: ${TODAY}. Output language: English.

STEP 1 — read these files first, in this order:
modes/_shared.md, modes/_profile.md, modes/_custom.md, modes/oferta.md, cv.md, config/profile.yml, and the JD file above.
Honor every rule in them: the source-of-truth boundary (facts about the candidate come ONLY from cv.md / config/profile.yml / modes/_profile.md — never invent experience or metrics), the scoring system in _shared.md, and the house rules in _custom.md (income-ASAP mode; junior and new-grad roles in scope BUT check graduation-window eligibility — the candidate graduated May 2024; programs requiring 2025+ graduation are hard-ineligible).

STEP 2 — PRE-SCREEN GATE: if the JD is an obvious categorical mismatch with the candidate archetypes in modes/_profile.md (hard French requirement, P.Eng-required-now, hard 8+/10+ years requirement, US-only work authorization or US-only hiring, security clearance unobtainable for a Canadian, graduation-window ineligibility, or an entirely different discipline), then write NO files at all and make your FINAL MESSAGE exactly one line:
${n} | SKIPPED | {company} | {reason, 25 words max}

STEP 3 — FULL EVALUATION (only if it passes the gate): follow modes/oferta.md exactly — Blocks A-F, Block G (Posting Legitimacy), Risk Summary, and the "## Machine Summary" YAML block. Because you are offline: skip web research; classify compensation per the "Company Type and Compensation Reliability" table in modes/_shared.md using JD evidence only, and note in Block G that online-research signals were unavailable in this offline evaluation.

Write EXACTLY these two files and nothing else:
1. reports/${n}-${slug}-${TODAY}.md — the full report. Header must include these lines: **URL:** ${url} | **Legitimacy:** {tier} | **Verification:** confirmed active (liveness sweep ${TODAY}) | **PDF:** not generated — run /career-ops pdf ${slug} to create on demand.
2. batch/tracker-additions/${n}-${slug}.tsv — ONE line, TAB-separated, 9 columns exactly:
${n}\t${TODAY}\t{Company}\t{actual role title}\tEvaluated\t{X.X}/5\t❌\t[${n}](reports/${n}-${slug}-${TODAY}.md)\t{one-line note}${jobgetherVia}

HARD LIMITS: do not modify data/applications.md, data/pipeline.md, data/discard.log, any .mjs script, any file in modes/, cv.md, config/, or anything under .git. Do not run git commands. Do not run node scripts. Only create the two files listed above.

FINAL MESSAGE (your last message, exactly one line):
${n} | {Company} | {Role} | {X.X}/5 | {verdict, 15 words max}`;
    fs.writeFileSync(path.join(WORKDIR, `prompt-${n}.md`), prompt);
    manifest.push({ num: n, slug, url, company: row.company, title: row.title, status: 'ready' });
    console.log(`${n} ready  ${slug}  (${row.title})`);
  } catch (e) {
    manifest.push({ num: n, slug, url, company: row.company, title: row.title, status: 'fetch-failed', error: e.message });
    console.log(`${n} FETCH-FAILED  ${row.company} ${row.title}: ${e.message}`);
  }
  num++;
}
fs.writeFileSync(path.join(WORKDIR, 'batch-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nready=${manifest.filter(m => m.status === 'ready').length} failed=${manifest.filter(m => m.status !== 'ready').length}`);
