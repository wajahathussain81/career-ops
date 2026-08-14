# Hub Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Worker model (user rule):** each task is dispatched to a **codex:codex-rescue** worker with a self-contained brief = the Global Constraints section + the full task text. The orchestrator (Claude) reviews the diff, runs the task's test command, and gates the commit before dispatching the next task.

**Goal:** Build `hub/` — a LAN web app on LXC 114 showing funnel metrics, an application browser (report/JD/resume/contacts per app), generated interview-prep pages with countdowns, and a chatbot that runs codex/claude agents — per `docs/superpowers/specs/2026-08-10-hub-dashboard-design.md`.

**Architecture:** Single Node stdlib-http server, zero build step, server-rendered HTML from template-literal view modules. Canonical files read at request time with an mtime cache; joins keyed on tracker number. Live updates via fs.watch → SSE. Data transport between machines is Syncthing (out of scope for code tasks; covered by the deploy runbook task). The hub never touches git.

**Tech Stack:** Node ≥ 20 ESM (`.mjs`), `node:http`, `node:crypto`, `node:child_process`, `node:fs`, existing `js-yaml` dep. No new npm dependencies. Tests: repo-native plain scripts with `pass/fail` from `tests/helpers.mjs`, auto-discovered by `test-all.mjs`.

## Global Constraints

- **No new npm dependencies.** Node stdlib + existing `js-yaml` only. Markdown rendering is a small vendored module (Task 6).
- All code ESM `.mjs`; follow repo style (check `existsSync` before reads, degrade gracefully, JSON-by-default CLIs).
- All hub code lives under `hub/`; tests under `tests/hub/`; **never add root-level `*.mjs` scripts** (SYSTEM_PATHS validator would fail CI).
- Server must be constructible for tests: `createServer(opts)` exported, listens on port 0 in tests, all machine-specifics injected via opts/env (`HUB_TOKEN`, `HUB_PORT` default 8484, `HUB_ROOT` default repo root, `HUB_WORKER_CMD` test override).
- Auth on every route except `GET/POST /login` and `/assets/*`: cookie `hub=<sha256hex(HUB_TOKEN)>`, compared with `crypto.timingSafeEqual`.
- Visual design: reuse the tokens/classes in `hub/reference/artifact.html` (`--ground/--surface/--ink/--verified/--reasoned/--forbidden` palette, `.tabs/.tab`, `.countdown`, `.sec` collapsible sections, `.say`, `.flag reasoned|forbid|proof`, light/dark via `prefers-color-scheme` + `[data-theme]`). Do not invent a new design language.
- The hub **never** runs git commands, never auto-submits anything, and writes tracker state **only** through `node set-status.mjs` (Task 7) or through agent runs (Task 10).
- Every task: run `node tests/hub/<file>.test.mjs` for the task, then commit. **Commit messages have NO AI-attribution trailers** (user's global rule). Prefix `hub:`.
- After the final task, full `node test-all.mjs` must pass.

**Files that already exist and are consumed (never modified by this plan):** `tracker-parse.mjs`, `set-status.mjs`, `stats.mjs`, `followup-cadence.mjs`, `salary-gap.mjs`, `detect-reposts.mjs`, `tests/helpers.mjs`, `templates/states.yml`, `data/*`, `reports/*`, `interview-prep/*`.

---

### Task 1: Server scaffold, auth, layout, CSS tokens

**Files:**
- Create: `hub/server.mjs`, `hub/lib/auth.mjs`, `hub/views/layout.mjs`, `hub/views/login.mjs`, `hub/assets/hub.css`, `hub/assets/hub.js` (empty shell for now)
- Modify: `.gitignore` (append `hub/logs/`)
- Test: `tests/hub/server.test.mjs`

**Interfaces:**
- Consumes: `hub/reference/artifact.html` (committed design reference).
- Produces:
  - `hub/server.mjs` exports `createServer({root, token, workerCmd})` → `http.Server`, and `route(app)` internals; when run directly (`node hub/server.mjs`) it listens on `HUB_PORT||8484` with `root=HUB_ROOT||<repo root>`, `token=HUB_TOKEN` (exit 1 with message if unset).
  - `hub/lib/auth.mjs` exports `cookieValue(token)` → sha256 hex string; `isAuthed(req, token)` → bool (parses `Cookie` header, timing-safe compare); `setAuthCookie(res, token)` (HttpOnly; SameSite=Lax; Path=/).
  - `hub/views/layout.mjs` exports `layout({title, active, body, banner})` → full HTML doc string with nav (Overview `/`, Applications `/apps`, Contacts `/contacts`, Prep `/prep`, Chat `/chat`), `<link href="/assets/hub.css">`, `<script src="/assets/hub.js" defer>`, and an empty `<div id="banner">` region when `banner` unset.
  - Router: exact-match + prefix table; unknown → 404 page via layout. `/assets/*` served from `hub/assets/` with content-type by extension, no auth.
  - `hub/assets/hub.css`: port the `:root` tokens, dark-mode blocks, `.tabs/.tab`, `.countdown`, `.sec`, `.say`, `.flag`, `.facts`, `.live` styles from `hub/reference/artifact.html`, plus new`.nav`, `.tile` (stat tiles), `.grid`, `table.data` styles using the same variables.

- [ ] **Step 1: Write the failing test** — `tests/hub/server.test.mjs`:

```js
// tests/hub/server.test.mjs — auth gate + login + static assets
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nHub — server auth');
const { createServer } = await import(pathToFileURL(join(ROOT, 'hub/server.mjs')).href);
const { cookieValue } = await import(pathToFileURL(join(ROOT, 'hub/lib/auth.mjs')).href);
const srv = createServer({ root: join(ROOT, 'tests/hub/fixtures'), token: 'test-token' });
await new Promise(r => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;

let r = await fetch(base + '/', { redirect: 'manual' });
if (r.status === 302 && r.headers.get('location') === '/login') pass('unauthed / redirects to /login');
else fail(`unauthed / gave ${r.status} ${r.headers.get('location')}`);

r = await fetch(base + '/login');
if (r.status === 200) pass('login page is public'); else fail(`login gave ${r.status}`);

r = await fetch(base + '/login', { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=wrong' });
if (r.status === 401) pass('wrong token rejected'); else fail(`wrong token gave ${r.status}`);

r = await fetch(base + '/login', { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=test-token' });
const cookie = (r.headers.get('set-cookie') || '');
if (r.status === 302 && cookie.includes('hub=')) pass('correct token sets cookie + redirects');
else fail(`login gave ${r.status} cookie=${cookie}`);

r = await fetch(base + '/', { headers: { cookie: `hub=${cookieValue('test-token')}` } });
if (r.status === 200) pass('authed / renders'); else fail(`authed / gave ${r.status}`);

r = await fetch(base + '/assets/hub.css');
if (r.status === 200 && (await r.text()).includes('--ground')) pass('assets served without auth, tokens present');
else fail('hub.css missing or lacks --ground token');

srv.close();
```

Also create `tests/hub/fixtures/.gitkeep` so the fixture root exists (Task 2 fills it).

- [ ] **Step 2: Run to verify failure** — `node tests/hub/server.test.mjs` → fails: cannot find `hub/server.mjs`.
- [ ] **Step 3: Implement** `hub/lib/auth.mjs`, `hub/views/layout.mjs`, `hub/views/login.mjs` (simple centered card with one password input named `token`), `hub/server.mjs` (router as an array of `{method, pattern, handler}`; parse body helper; 302 helper; when a route handler throws → 500 page with message). Port CSS from the reference file.
- [ ] **Step 4: Run to verify pass** — `node tests/hub/server.test.mjs` → all pass lines.
- [ ] **Step 5: Commit** — `git add -A hub tests/hub .gitignore && git commit -m "hub: server scaffold with token auth, layout, design tokens"`

### Task 2: Fixtures + data readers (`lib/data.mjs`)

**Files:**
- Create: `hub/lib/data.mjs`, plus fixtures under `tests/hub/fixtures/`
- Test: `tests/hub/data.test.mjs`

**Interfaces:**
- Consumes: root-level `tracker-parse.mjs` (`resolveColumns(lines)`, `parseTrackerRow(line, colmap)`, `isSeparatorRow`, `isHeaderRow`) — read that file before writing the loader; it defines column resolution and the score/status swap rules.
- Produces (all take `root` = repo root; all return `[]`/`null` when a file is missing; all mtime-cached):
  - `loadApplications(root)` → `[{num:Number, date, company, role, score:String|null, status, via:String|null, reportPath:String|null, notes}]`
  - `loadStatusLog(root)` → `[{num:Number, date, from, to, source}]` (tab-split of `data/status-log.tsv`)
  - `loadPdfIndex(root)` → `Map<reportNum, {pdf, html, format, date}>` (skip `#` comment lines)
  - `loadContacts(root)` → `[{name, company, type, title, phone, email, linkedin, tracker:Number|null, notes}]`
  - `loadFollowUps(root)` → `[{num, appNum:Number, date, company, role, channel, contact, notes}]` (markdown table rows)
  - `loadPipelineCount(root)` → Number of pending URL lines in `data/pipeline.md` (lines matching `^\s*[-*] ` or containing `http`)
  - `listPrepDirs(root)` → `[{slug, dir, hasPageYml, jdPath|null, resumePath|null}]` from `interview-prep/*/` (dirs only, skip `sessions`)
  - `getApplication(root, num)` → `{app, timeline:[statusLog rows], resume:{path, exists}|null, contacts:[], followUps:[], reportFile:String|null, jdFile:String|null, prep:{slug,dir}|null}` — joins all of the above; `reportFile` resolved from the tracker report link (`reports/NNN-*.md`), `jdFile` from `prep.jdPath` else a `jds/` file whose name contains `-NNN-`, `prep` matched by slug suffix `-NNN`.
  - `invalidate()` — clears the cache (used by watch, Task 8). Cache: module-level `Map<absPath,{mtimeMs, value}>`; helper `cached(absPath, parseFn)`.

- [ ] **Step 1: Create fixtures** (exact contents):

`tests/hub/fixtures/data/applications.md`:
```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-08-01 | Acme Robotics | Firmware Engineer | 4.5/5 | Interview | ✅ | [1](../reports/001-acme-robotics-2026-08-01.md) | req JR-100 |
| 2 | 2026-08-02 | Beta Corp | Test Engineer | 4.0/5 | Applied | ✅ | [2](../reports/002-beta-corp-2026-08-02.md) | |
| 3 | 2026-08-03 | Gamma Inc | SDET | 3.5/5 | Rejected | ❌ | [3](../reports/003-gamma-inc-2026-08-03.md) | |
| 4 | 2026-08-09 | Delta LLC | Embedded Dev | 4.2/5 | Evaluated | ❌ | [4](../reports/004-delta-llc-2026-08-09.md) | |
```

`tests/hub/fixtures/data/status-log.tsv` (tab-separated, matching real file: num, date, from, to, source, note):
```
1	2026-08-01	Evaluated	Applied	set-status	
1	2026-08-04	Applied	Responded	set-status	
1	2026-08-06	Responded	Interview	set-status	
2	2026-08-02	Evaluated	Applied	set-status	
3	2026-08-03	Evaluated	Applied	set-status	
3	2026-08-07	Applied	Rejected	set-status	
```

`tests/hub/fixtures/data/pdf-index.tsv`:
```
# report	pdf	html	format	date — written by generate-pdf.mjs, do not edit
001	output/cv-acme.pdf	output/cv-acme.html	letter	2026-08-01
002	output/cv-beta.pdf	output/cv-beta.html	letter	2026-08-02
```

`tests/hub/fixtures/data/contacts.tsv`:
```
# name	company	type	title	phone	email	linkedin	tracker#	notes
Jane Doe	Acme Robotics	recruiter	Senior Recruiter		jane@acme.test	https://linkedin.test/janedoe	1	screened 08-03
Sam Lee	Beta Corp	hiring-manager	Eng Manager				2	
```

`tests/hub/fixtures/data/follow-ups.md`:
```markdown
# Follow-ups

| num | appNum | date | company | role | channel | contact | notes |
|---|---|---|---|---|---|---|---|
| 1 | 2 | 2026-08-05 | Beta Corp | Test Engineer | LinkedIn note | Sam Lee | sent |
```

`tests/hub/fixtures/data/pipeline.md`:
```markdown
# Pipeline
- https://jobs.test/a
- https://jobs.test/b
```

`tests/hub/fixtures/reports/001-acme-robotics-2026-08-01.md`:
```markdown
# Acme Robotics — Firmware Engineer
**Score:** 4.5/5
**URL:** https://jobs.test/acme
**Legitimacy:** Verified

## Machine Summary
```yaml
score: 4.5
```
```
(plus minimal `002-…`, `003-…`, `004-…` files with just an H1 line)

`tests/hub/fixtures/interview-prep/acme-firmware-1/jd.md`: `# Acme JD` and an empty `resume.pdf` (one byte `%`).

- [ ] **Step 2: Write the failing test** — `tests/hub/data.test.mjs`:

```js
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nHub — data readers');
const FIX = join(ROOT, 'tests/hub/fixtures');
const d = await import(pathToFileURL(join(ROOT, 'hub/lib/data.mjs')).href);

const apps = d.loadApplications(FIX);
if (apps.length === 4 && apps[0].company === 'Acme Robotics' && apps[0].num === 1) pass('loadApplications parses 4 rows');
else fail(`apps: ${JSON.stringify(apps[0])} len=${apps.length}`);
if (apps[0].score === '4.5/5' && apps[0].status === 'Interview') pass('score/status columns correct');
else fail(`score=${apps[0].score} status=${apps[0].status}`);

const log = d.loadStatusLog(FIX);
if (log.length === 6 && log[2].to === 'Interview' && log[2].num === 1) pass('status log parsed');
else fail(`log len=${log.length}`);

const joined = d.getApplication(FIX, 1);
if (joined.app.company === 'Acme Robotics' && joined.timeline.length === 3) pass('join: timeline attached');
else fail(`timeline=${joined.timeline.length}`);
if (joined.contacts.length === 1 && joined.contacts[0].name === 'Jane Doe') pass('join: contacts attached');
else fail(`contacts=${JSON.stringify(joined.contacts)}`);
if (joined.reportFile && joined.reportFile.endsWith('001-acme-robotics-2026-08-01.md')) pass('join: report resolved');
else fail(`reportFile=${joined.reportFile}`);
if (joined.prep && joined.prep.slug === 'acme-firmware-1') pass('join: prep dir matched by -num suffix');
else fail(`prep=${JSON.stringify(joined.prep)}`);
if (joined.resume && joined.resume.exists === false) pass('join: resume path from pdf-index, exists=false in fixture');
else fail(`resume=${JSON.stringify(joined.resume)}`);

const fu = d.loadFollowUps(FIX);
if (fu.length === 1 && fu[0].appNum === 2) pass('follow-ups parsed'); else fail(`fu=${JSON.stringify(fu)}`);
if (d.loadPipelineCount(FIX) === 2) pass('pipeline count'); else fail(`pipeline=${d.loadPipelineCount(FIX)}`);
if (d.loadApplications(join(FIX, 'nonexistent')).length === 0) pass('missing root degrades to []');
else fail('missing root did not degrade');
```

- [ ] **Step 3: Run to verify failure**, **Step 4: Implement `hub/lib/data.mjs`** (import tracker-parse via relative `../../tracker-parse.mjs`), **Step 5: Run to verify pass**.
- [ ] **Step 6: Commit** — `hub: data readers with tracker joins and mtime cache`

### Task 3: Funnel math (`lib/funnel.mjs`)

**Files:** Create `hub/lib/funnel.mjs` · Test `tests/hub/funnel.test.mjs`

**Interfaces:**
- Produces: `computeFunnel({apps, statusLog, today})` → 
  `{counts: {Evaluated,Applied,Responded,Interview,Offer,Hired,Rejected,Discarded,SKIP}, ever: {applied, responded, interview, offer, hired}, conversions: {appliedToResponded, respondedToInterview, interviewToOffer, offerToHired}, responseRate, quotaToday: {applied, target: 10}, appliedByDay: Map<date, n>}`.
  Rules: `counts` = current tracker status frequencies. `ever.X` = number of distinct apps whose current status is X **or** that have any status-log row with `to === X`. Conversions are `ever` ratios (0 when denominator 0, never NaN). `responseRate = ever.responded / ever.applied`. `quotaToday.applied` = status-log rows with `to === 'Applied'` and `date === today`.

- [ ] **Step 1: Write the failing test** — `tests/hub/funnel.test.mjs` using Task 2 fixtures:

```js
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
console.log('\nHub — funnel');
const FIX = join(ROOT, 'tests/hub/fixtures');
const d = await import(pathToFileURL(join(ROOT, 'hub/lib/data.mjs')).href);
const { computeFunnel } = await import(pathToFileURL(join(ROOT, 'hub/lib/funnel.mjs')).href);
const f = computeFunnel({ apps: d.loadApplications(FIX), statusLog: d.loadStatusLog(FIX), today: '2026-08-02' });
if (f.ever.applied === 3) pass('ever.applied counts log+current (1,2,3)'); else fail(`ever.applied=${f.ever.applied}`);
if (f.ever.responded === 1 && f.ever.interview === 1) pass('ever responded/interview'); else fail(JSON.stringify(f.ever));
if (Math.abs(f.responseRate - 1/3) < 1e-9) pass('response rate 1/3'); else fail(`rr=${f.responseRate}`);
if (Math.abs(f.conversions.respondedToInterview - 1) < 1e-9) pass('responded→interview 100%'); else fail(`${f.conversions.respondedToInterview}`);
if (f.conversions.offerToHired === 0) pass('zero denominator → 0, not NaN'); else fail(`${f.conversions.offerToHired}`);
if (f.quotaToday.applied === 1 && f.quotaToday.target === 10) pass('quota today from status log'); else fail(JSON.stringify(f.quotaToday));
if (f.counts.Interview === 1 && f.counts.Evaluated === 1) pass('current counts'); else fail(JSON.stringify(f.counts));
```

- [ ] **Steps 2–5:** run-fail → implement → run-pass → commit `hub: funnel and conversion math`.

### Task 4: Analytics shell-outs (`lib/scripts.mjs`)

**Files:** Create `hub/lib/scripts.mjs` · Test `tests/hub/scripts.test.mjs`

**Interfaces:**
- Produces: `runJson(root, script, args=[], timeoutMs=15000)` → Promise of parsed JSON or `{__error: '<message>'}` (never throws, never rejects); `getStats(root)`, `getFollowupCadence(root)`, `getSalaryGap(root)`, `getReposts(root)` — thin wrappers naming the root scripts (`stats.mjs`, `followup-cadence.mjs`, `salary-gap.mjs`, `detect-reposts.mjs`), executed with `execFile('node', [script, ...args], {cwd: root})`. Overview must render even when every wrapper returns `__error` (fixture root has no such scripts — that IS the error-path test).

- [ ] **Step 1: Test** — `tests/hub/scripts.test.mjs`: create `tests/hub/fixtures/ok.mjs` printing `{"ok":true}` and `tests/hub/fixtures/bad.mjs` printing `not json`; assert `runJson(FIX,'ok.mjs')` → `{ok:true}`; `runJson(FIX,'bad.mjs')` → has `__error`; `runJson(FIX,'missing.mjs')` → has `__error`; `getStats(FIX)` → has `__error` (no stats.mjs in fixtures) — four pass lines.
- [ ] **Steps 2–5:** run-fail → implement → run-pass → commit `hub: analytics script wrappers with graceful degradation`.

### Task 5: Overview page

**Files:** Create `hub/views/overview.mjs` · Modify `hub/server.mjs` (wire `/` and `/api/overview`) · Test `tests/hub/overview.test.mjs`

**Interfaces:**
- Consumes: `computeFunnel`, data readers, `getFollowupCadence`, `getStats`, `listPrepDirs` + prep meta (Task 9 adds real datetimes; until then upcoming-interviews section lists apps with status `Interview`).
- Produces: `GET /api/overview` → JSON `{funnel, quotaToday, inbox, followupsDue:[…]|{__error}, upcoming:[{num, company, role}], recent:[last 10 status-log rows newest first]}`; `GET /` → HTML containing `.tile` elements with ids `tile-applied`, `tile-responded`, `tile-interview`, `tile-offer`, `tile-rejected`, `tile-quota`, a `#recent` list, and `#upcoming` section. `renderOverview(data)` exported from the view module.

- [ ] **Step 1: Test** — `tests/hub/overview.test.mjs`: boot server on fixtures with auth cookie; `GET /api/overview` → `funnel.ever.applied === 3`, `inbox === 2`, `recent.length === 6`; `GET /` HTML includes `tile-quota` and `Acme Robotics` (upcoming, status Interview). Four pass lines.
- [ ] **Steps 2–5:** run-fail → implement (tiles show ever-counts with conversion % subtitles; quota tile shows `1/10` style; recent list rows `#num date from → to`) → run-pass → commit `hub: overview page with funnel tiles, quota, recent activity`.

### Task 6: Markdown renderer, applications browser + detail

**Files:** Create `hub/lib/md.mjs`, `hub/views/apps.mjs`, `hub/views/appdetail.mjs`, `hub/views/contacts.mjs` · Modify `hub/server.mjs` (routes `/apps`, `/apps/:num`, `/contacts`, `GET /api/apps`, `GET /files/resume/:num` serving the PDF when it exists) · Test `tests/hub/apps.test.mjs`

**Interfaces:**
- Produces:
  - `md.mjs` exports `mdToHtml(src)` — handles: `#`–`####` headings, `**bold**`, `*italic*`, backtick code, fenced code blocks, `- ` lists, `1. ` lists, links `[t](u)`, tables (`| a | b |` rows with separator), paragraphs. HTML-escape everything first, then transform. ~80 lines; no dependency.
  - `GET /api/apps?status=&q=&minScore=` → `{rows:[…tracker rows…], total}` with case-insensitive `q` against company+role+notes, `status` exact, `minScore` numeric against the `X.X/5` prefix.
  - `/apps` page: filter form (status select from `templates/states.yml` keys, text input, min-score select), `table.data` with columns #/Date/Company/Role/Score/Status, rows link to `/apps/{num}`. Client-side fetch-and-rerender on filter change lives in `hub/assets/hub.js` (`initAppsPage()` guarded by element presence).
  - `/apps/{num}` page: facts header (`.facts` list: company, role, score, status, via, date, req-note); status timeline (ordered rows from `timeline`); tab bar (`.tabs`, reused artifact classes, client toggle in hub.js `initTabs()`) with panes: **Report** (`mdToHtml` of reportFile), **JD** (`mdToHtml` of jdFile or "No JD on file"), **Resume** (`<embed src="/files/resume/{num}" type="application/pdf">` when `resume.exists`, else filename + `not synced` note, else "No PDF recorded"), **People** (contacts rows + follow-ups rows for this app).
- Consumes: Task 2 `getApplication`, `loadContacts`; Task 3 nothing.

- [ ] **Step 1: Test** — `tests/hub/apps.test.mjs`: assert `mdToHtml('# T\n**b** and [l](http://x)')` contains `<h1>`, `<strong>`, `<a href="http://x"`; escapes `<script>` input; `GET /api/apps?q=acme` → 1 row; `?status=Applied` → 1 row (Beta); `?minScore=4` → 3 rows; `GET /apps/1` HTML contains `Acme Robotics`, `Interview`, `tab` markup, and `Jane Doe`; `GET /apps/999` → 404; `GET /files/resume/1` → 404 (fixture pdf path doesn't exist under fixture root — pdf-index points at `output/cv-acme.pdf` which is absent). Eight pass lines.
- [ ] **Steps 2–5:** run-fail → implement → run-pass → commit `hub: applications browser, detail tabs, vendored markdown renderer, contacts page`.

### Task 7: Serialized writes — status endpoint (`lib/lock.mjs`)

**Files:** Create `hub/lib/lock.mjs` · Modify `hub/server.mjs` (`POST /api/status`), `hub/views/appdetail.mjs` (status `<select>` + hub.js `initStatusControl()`) · Test `tests/hub/status.test.mjs`

**Interfaces:**
- Produces: `lock.mjs` exports `withLock(fn)` — module-level promise-chain mutex: `let tail = Promise.resolve(); export function withLock(fn){ const p = tail.then(fn, fn); tail = p.catch(() => {}); return p; }` — shared by status writes (this task) and agent runs (Task 10).
  `POST /api/status` body `{num, state, note?}` → runs `execFile('node', ['set-status.mjs', String(num), state, ...(note?['--note',note]:[])], {cwd: root})` inside `withLock`; 200 `{ok:true}` on exit 0, 422 `{ok:false, stderr}` otherwise; 400 on missing fields.
- Consumes: root `set-status.mjs` (real one in repo; fixture root gets a **stub** `tests/hub/fixtures/set-status.mjs` that appends its argv to `tests/hub/fixtures/.status-calls` and exits 0, or exits 3 with stderr `bad state` when state is `Nope`).

- [ ] **Step 1: Test** — `tests/hub/status.test.mjs`: POST `{num:2, state:'Responded'}` → 200 and `.status-calls` contains `2 Responded`; POST `{num:2, state:'Nope'}` → 422 with `stderr` containing `bad state`; POST missing num → 400; fire 5 parallel POSTs and assert `.status-calls` has 5 in-order lines (mutex serialization; stub sleeps 50ms via `setTimeout` before writing). Clean up `.status-calls` at start. Four pass lines.
- [ ] **Steps 2–5:** run-fail → implement → run-pass → commit `hub: set-status write endpoint behind shared mutex`.

### Task 8: Live updates — fs.watch + SSE (`lib/watch.mjs`)

**Files:** Create `hub/lib/watch.mjs` · Modify `hub/server.mjs` (`GET /api/events`, start watcher, conflict banner state), `hub/views/layout.mjs` (banner renders conflict list), `hub/assets/hub.js` (`initLive()`: EventSource; on `data-changed` re-fetch the page's `/api/*` source and re-render its data region; every page's dynamic region is a single `<div id="live-root">` re-rendered from the API JSON) · Test `tests/hub/watch.test.mjs`

**Interfaces:**
- Produces: `watchPaths(root, relPaths, {onChange, onConflict})` → `{close()}`; watches `data/`, `reports/`, `interview-prep/`, `jds/` recursively (`fs.watch(dir, {recursive:true})`), debounces 300 ms, calls `onChange([changedRelPaths])`; any filename containing `.sync-conflict` → `onConflict([paths])` (persisted in a module-level Set exposed as `getConflicts()`; conflicts clear when the file disappears on next scan).
  SSE endpoint: `Content-Type: text/event-stream`, sends `event: data-changed\ndata: {"paths":[…]}\n\n` on change and `event: conflict\ndata: {"files":[…]}\n\n`; heartbeat comment every 25 s; server calls `data.invalidate()` before broadcasting.
- Consumes: Task 2 `invalidate()`.

- [ ] **Step 1: Test** — `tests/hub/watch.test.mjs`: start watcher on a temp copy of fixtures (`fs.cpSync` into `tmpdir()`); append a line to `data/status-log.tsv` → within 2 s `onChange` fires with a path containing `status-log`; create `data/applications.sync-conflict-x.md` → `onConflict` fires; SSE: open `fetch(base+'/api/events', {headers:{cookie}})`, read stream, touch a file, assert a `data-changed` frame arrives within 3 s. Three pass lines. Close watcher + server (test must exit; use `AbortController` on the fetch).
- [ ] **Steps 2–5:** run-fail → implement → run-pass → commit `hub: fs.watch to SSE live updates with sync-conflict banner`.

### Task 9: Interview-prep pipeline (`gen-prep.mjs`, `/prep`)

**Files:** Create `hub/gen-prep.mjs`, `hub/views/prep.mjs`, `hub/prep-page-mode.md` · Modify `hub/server.mjs` (routes `/prep`, `/prep/:slug`), `hub/lib/data.mjs` (`loadPrepPage(root, slug)` → parsed `page.yml` or null), `hub/assets/hub.js` (`initCountdown()`: elements `[data-dt]` tick every second → `Xd HH:MM:SS`; past → `started`) · Test `tests/hub/prep.test.mjs`

**Interfaces:**
- Produces:
  - `page.yml` schema (documented at top of `hub/prep-page-mode.md`): `meta: {company, role, tracker, round, datetime (ISO with offset), duration_min, platform, interviewer}` and `sections: []` where each item is one of:
    `{type: facts, items: [{k, v}]}` · `{type: flag, kind: proof|reasoned|forbid, title, body}` (body markdown) · `{type: say, title, label?, paras: []}` · `{type: list, title, items: []}` (items markdown) · `{type: stories, stories: [{title, s, t, a, r, reflection?, boundary?}]}` · `{type: questions, items: []}`.
  - `gen-prep.mjs` exports `renderPrepPage(page)` → HTML fragment (artifact classes: `.head/.facts` masthead from meta, numbered `.sec` per section, `.say`, `.flag`, countdown span `<span class="countdown" data-dt="{meta.datetime}">`); CLI `node hub/gen-prep.mjs <slug>` prints the fragment (root from `HUB_ROOT` or cwd).
  - `/prep`: artifact-style sticky `.bar` with one `.tab` per **future-dated** page.yml (label = company, sublabel = local datetime), shared countdown line for the selected tab, tab panes = rendered fragments; past interviews listed under "Archive" as links. `/prep/:slug`: single rendered page. Rendering is server-side; the server re-renders when `page.yml` mtime changes (reuse `cached()`).
  - `hub/prep-page-mode.md`: the authoring prompt for agents — instructs: read `interview-prep/{slug}/prep*.md` + tracker row; emit ONLY `page.yml` in the schema above; content must come exclusively from those files (source-of-truth boundary); preserve epistemic labels (verified→proof, reasoned, forbidden→forbid); never invent logistics; datetime must include UTC offset.
- Consumes: `js-yaml` (existing dep) for parsing; Task 2 `listPrepDirs`.

- [ ] **Step 1: Fixture** — `tests/hub/fixtures/interview-prep/acme-firmware-1/page.yml`:

```yaml
meta:
  company: Acme Robotics
  role: Firmware Engineer
  tracker: 1
  round: Hiring manager
  datetime: 2030-01-15T11:00:00-07:00
  duration_min: 45
  platform: Teams
  interviewer: Pat Smith
sections:
  - type: flag
    kind: proof
    title: Lead with this
    body: You built the **CI pipeline**.
  - type: say
    title: Opening answer
    label: Say this
    paras: ["I am an embedded engineer.", "I built the pipeline."]
  - type: questions
    items: ["Why is the role open?"]
```

- [ ] **Step 2: Test** — `tests/hub/prep.test.mjs`: `renderPrepPage(loadPrepPage(FIX,'acme-firmware-1'))` contains `data-dt="2030-01-15T11:00:00-07:00"`, `class="say"`, `flag proof`, `<strong>CI pipeline</strong>`, and section numbering `01`; `GET /prep` shows a tab labeled `Acme Robotics` (future date); `GET /prep/acme-firmware-1` → 200; `GET /prep/missing` → 404; CLI `node hub/gen-prep.mjs acme-firmware-1` with `HUB_ROOT=FIX` prints fragment (execFileSync, assert exit 0 + `.say` in stdout). Six pass lines.
- [ ] **Steps 3–6:** run-fail → implement → run-pass → commit `hub: prep page schema, deterministic renderer, tabbed countdown view, authoring prompt`.

### Task 10: Agent console (`lib/agent.mjs`, `/chat`)

**Files:** Create `hub/lib/agent.mjs`, `hub/views/chat.mjs`, `tests/hub/fixtures/fake-worker.mjs` · Modify `hub/server.mjs` (`POST /api/chat`, `POST /api/chat/kill`, route `/chat`), `hub/assets/hub.js` (`initChat()`: textarea + worker toggle radio codex|claude, send → POST, stream rendered from SSE `chat` events, kill button) · Test `tests/hub/agent.test.mjs`

**Interfaces:**
- Produces:
  - `agent.mjs` exports `buildArgv(worker, prompt)` → `['codex','exec',prompt]` or `['claude','-p',prompt]`; `PREAMBLE` const (verbatim): `"Hub run. House rules: never submit/send/apply to anything; never run git; tracker writes only via node set-status.mjs or the batch TSV + merge-tracker.mjs flow; user-facing content only from cv.md/article-digest.md/profile files."`; `startRun({root, prompt, worker, workerCmd, onChunk, onExit})` → `{kill()}` — spawns `workerCmd` (array, test override) or `buildArgv(worker, PREAMBLE + '\n\n' + prompt)` with `{cwd: root, detached: true}`, streams stdout+stderr to `onChunk(text)`, 30-min timer → kill; `kill()` signals the process group (`process.kill(-pid, 'SIGTERM')`). Exactly one live run (module state `current`); a second `startRun` while active throws `Error('busy')`.
  - `POST /api/chat` `{prompt, worker}` → inside `withLock` (Task 7 — shared with status writes): 202 `{ok:true}`; output broadcast over the Task 8 SSE channel as `event: chat` frames `{"chunk": "..."}` and final `event: chat-exit` `{"code": n}`; 409 `{error:'busy'}` when a run is live. Transcript appended to `hub/logs/YYYY-MM-DD.md` (`## HH:MM worker\nprompt\n---\noutput`).
  - `fake-worker.mjs`: prints `line one`, sleeps 100 ms, prints `line two`, exits 0; with argv containing `fail` → prints to stderr, exit 3.
- Consumes: `withLock` (Task 7), SSE broadcast (Task 8).

- [ ] **Step 1: Test** — `tests/hub/agent.test.mjs`: `buildArgv('codex','x')` → `['codex','exec','x']`, `buildArgv('claude','x')` → `['claude','-p','x']`; `startRun` with `workerCmd: ['node', join(FIX,'fake-worker.mjs')]` collects chunks containing `line one` and `line two`, exit code 0; second concurrent `startRun` throws `busy`; failing argv → onExit code 3 and stderr chunk captured; HTTP: POST `/api/chat` with `HUB_WORKER_CMD` env-injected server → 202, SSE stream receives a `chat` frame and a `chat-exit` frame; second POST while running → 409; transcript file exists under fixture `hub-logs` dir (log dir = `opts.logDir` injectable, default `hub/logs`). Seven pass lines.
- [ ] **Steps 2–5:** run-fail → implement → run-pass → commit `hub: agent console with codex/claude workers, SSE streaming, single-run lock`.

### Task 11: Deploy artifacts + runbook

**Files:** Create `hub/deploy/hub.service`, `hub/deploy/hub.env.example`, `hub/deploy/stignore-data.txt`, `hub/deploy/README.md`

**Interfaces:** documentation-only task; no code, no test file. Verification = orchestrator review against spec §5/§14.

- [ ] **Step 1: Write `hub/deploy/hub.service`:**

```ini
[Unit]
Description=career-ops hub
After=network-online.target

[Service]
Type=simple
User=career
WorkingDirectory=/opt/career-ops
EnvironmentFile=/etc/career-ops/hub.env
ExecStart=/usr/bin/node hub/server.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`hub.env.example`: `HUB_TOKEN=change-me`, `HUB_PORT=8484`, `HUB_ROOT=/opt/career-ops`.

- [ ] **Step 2: Write `hub/deploy/stignore-data.txt`** (contents shared by every Syncthing folder):

```
*.lock
(?d).DS_Store
cache
applications.db
parser-output
*.sync-conflict*
```

- [ ] **Step 3: Write `hub/deploy/README.md`** covering, in order, with exact commands where possible: (1) NAS: create dataset `/mnt/Data/career-ops` + `sync/{data,reports,interview-prep,jds,resumes}` + `config/`, install Syncthing TrueNAS catalog app pointed at those paths, ZFS periodic snapshot task (15 min / keep 24h quarter-hours + 30 daily); (2) Syncthing on Mac (`brew install syncthing`) and LXC (apt), device-ID exchange with NAS as introducer, five shared folders mapping repo paths ↔ NAS `sync/` paths (`output/upload` ↔ `sync/resumes`), paste `stignore-data.txt` into each folder's ignore patterns; (3) LXC: Node ≥ 20 check, `codex` + `claude` CLI install/login verification commands (`codex exec "reply OK"`, `claude -p "reply OK"`), git `update-index --skip-worktree` on the five synced paths, systemd install (`cp hub.service`, `systemctl enable --now hub`); (4) manual smoke checklist from spec §13 (SSE liveness, chat end-to-end, forge a `.sync-conflict` file → banner, status dropdown round-trip visible on Mac within seconds); (5) explicit warning box: `.git/` must never be inside a synced folder.
- [ ] **Step 4: Commit** — `hub: deploy unit, syncthing runbook, stignore`

### Task 12: Integration pass

**Files:** none new (fixes only, wherever the suite points)

- [ ] **Step 1:** `for t in tests/hub/*.test.mjs; do node "$t" || break; done` — all green.
- [ ] **Step 2:** `node test-all.mjs` — full suite green (hub tests ride auto-discovery; also proves no root-script/SYSTEM_PATHS violations and no personal-data check trips).
- [ ] **Step 3:** Boot against the real repo on the Mac: `HUB_TOKEN=dev node hub/server.mjs`, verify `/` shows real funnel numbers, `/apps/739` renders the Magnet report/JD/people tabs, `/prep` empty-state is sane (no page.yml exists yet), `/chat` streams a trivial codex run. Fix what falls out; each fix is its own commit.
- [ ] **Step 4:** Final commit `hub: integration fixes` (if any) — then report back for deploy scheduling (LXC/NAS steps from Task 11 run with the user).

---

## Self-review notes

- **Spec coverage:** §4 layout → T1/T9/T10/T11; §5 sync → T8 (conflict surface) + T11 (runbook; Syncthing itself is ops, not code); §6 data → T2–T4; §7 pages → T5 (overview), T6 (apps/contacts), T9 (prep), T10 (chat), SSE → T8; §8 → T9; §9 → T7; §10 → T10; §11 auth → T1; §12 error rows → T2 (missing files), T4 (`__error`), T7 (422 stderr), T8 (banner), T10 (spawn failure surfaces via chunks/exit); §13 tests → per-task + T12; §14 prerequisites → T11 runbook + T12 step 3.
- **Deferred by design:** `/api/overview` upcoming-interviews uses status until T9's page.yml datetimes exist; T9 does NOT retrofit the overview — the overview's upcoming section upgrades to page.yml data in T9 (wired in `renderOverview` via `listPrepDirs` + `loadPrepPage`, future-dated only, falling back to status list). This sentence is the requirement; T9 implementer: include it.
- **Type consistency check:** `withLock` (T7) used by T10; `invalidate()` (T2) used by T8; `cookieValue` (T1) used by every server test; `loadPrepPage` added in T9 lives in `data.mjs`; fixture root doubles as `HUB_ROOT` everywhere.
