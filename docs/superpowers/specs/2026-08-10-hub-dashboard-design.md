# Hub — career-ops web dashboard, prep pages, and agent console

**Date:** 2026-08-10 · **Status:** approved design, pending implementation plan
**Branch:** `main` (replace with your private deployment branch if different)

## 1. Purpose

A single LAN-accessible web app ("the hub") that is the one-stop view of the job
search: funnel metrics and conversion rates, an organized browser of every
application (report, JD, resume used, status history, contacts touched),
generated interview-prep pages with live countdowns, and an embedded chatbot
that drives the normal codex/claude agents against the repo.

## 2. Non-goals

- No multi-user support, no accounts beyond a single shared token.
- No HTTPS / WAN exposure (LAN only; Tailscale can be layered later, unplanned).
- No new authoritative database — files stay canonical (repo principle #918).
- No write UI beyond (a) the chatbot and (b) a status dropdown backed by
  `set-status.mjs`. No manual edit forms.
- Nothing ever auto-submits an application, sends an email, or clicks Apply.
  The repo's ethical rules bind the hub's agents exactly as they bind CLI runs.
- Not upstreamable; no SYSTEM_PATHS registration, free to assume this user's
  homelab.

## 3. Topology

| Node | Role |
|------|------|
| **LXC 114** (Proxmox, `192.0.2.10` example host) | Runs `hub/server.mjs` as systemd unit `hub.service`, port from env (default 8484). Runs Syncthing (native service or container). Executes chatbot agents in its repo checkout. |
| **your NAS** (TrueNAS SCALE 24.10, `192.0.2.20` example host) | Syncthing catalog app. Always-on sync hub + third copy. Dedicated ZFS dataset, see §5. |
| **Mac** | Existing working checkout; user's normal sessions keep writing files as today. Syncthing (Homebrew) syncs the data paths. |

Any LAN device (Mac, phone) uses the hub at `http://<lxc-ip>:8484`.

## 4. Repo layout (new code)

```
hub/
  server.mjs          # HTTP server, Node stdlib http, zero build step, ESM .mjs
  lib/data.mjs        # file readers + tracker-number joins, mtime-cached
  lib/watch.mjs       # fs.watch on data paths -> SSE fanout to open pages
  lib/agent.mjs       # worker spawn (codex exec | claude -p) + SSE streaming
  lib/scripts.mjs     # child_process wrappers for existing analytics .mjs (JSON)
  views/              # HTML template-literal modules, server-rendered
  assets/hub.css      # design system extracted from the approved artifact
  assets/hub.js       # countdown tick, tabs, SSE client, filters (vanilla)
  gen-prep.mjs        # page.yml -> prep page renderer (deterministic)
  prep-page-mode.md   # agent prompt: prep.md -> page.yml conversion
  deploy/hub.service  # systemd unit (LXC)
  deploy/README.md    # LXC + NAS + Mac setup steps (Syncthing IDs, dataset)
  logs/               # chat transcripts (gitignored)
tests/hub/*.test.mjs  # auto-discovered by test-all
```

New deps: none required (stdlib http, existing `js-yaml`). If markdown
rendering needs a lib, prefer a single tiny vendored renderer over a dep tree.

## 5. Sync design (Syncthing, NAS-centered — replaces git as transport)

Git is **out of the live path entirely**: the hub never pulls, commits, or
pushes. Git remains an optional Mac-side offsite backup, unchanged habits.

- **Engine:** Syncthing, three devices (Mac, LXC, NAS), NAS as always-on
  hub/introducer so Mac and LXC need not be up simultaneously. LAN latency
  target: change visible on other nodes in ~1–2 s.
- **Shared folders** (one Syncthing folder each, same folder IDs on all nodes):
  `data/`, `reports/`, `interview-prep/`, `jds/`, `output/upload/`.
  Syncing `output/upload/` is what makes "resume used" PDFs available to the
  hub even though `output/` is gitignored.
- **Never synced:** `.git/` (not under any shared folder — corruption risk),
  and via `.stignore` in each folder: `*.lock`, `data/cache/`,
  `data/applications.db` (derived index; each machine regenerates),
  `data/parser-output/`, `*.sync-conflict*` handled below.
- **NAS dataset** — dedicated, isolated from all other NAS services:

```
/mnt/Data/career-ops/            # new ZFS dataset, dedicated user, own perms
  sync/data/                     # Syncthing folder targets
  sync/reports/
  sync/interview-prep/
  sync/jds/
  sync/resumes/                  # maps to output/upload/ on Mac + LXC
  config/                        # Syncthing app config/state
```

- **History/rollback:** ZFS periodic snapshot task on the dataset
  (every 15 min, keep 24 h of quarter-hours + 30 daily), replacing git as the
  versioning layer for pipeline data.
- **Conflicts:** Syncthing writes `*.sync-conflict*` files instead of merging.
  `lib/watch.mjs` detects them and the hub shows a persistent red banner
  listing the files; resolution is manual. Expected near-zero (one human, and
  the hub serializes its own writers, §9–10).
- **Existing LXC git checkout:** the LXC repo stops being a data git client.
  Code updates to `hub/` still arrive by git pull (manual or the existing
  homelab pipeline), but the five synced data paths are owned by Syncthing.
  The deploy doc must set the LXC checkout to skip-worktree / ignore local
  drift on synced paths so a code pull never fights the synced data.

## 6. Data layer

Read canonical files at request time, cached by mtime (re-parse only files
that changed). All joins key on tracker number.

| Source | Provides |
|--------|----------|
| `data/applications.md` via existing `tracker-parse.mjs` | rows: num, date, company, role, score, status, via, report link, notes |
| `data/status-log.tsv` | per-app status transitions (num, date, from, to, source) → timeline + stage-duration stats |
| `data/pdf-index.tsv` | report → resume PDF/HTML path, format, date |
| `data/contacts.tsv` | people, keyed by `tracker#` |
| `data/follow-ups.md` | follow-up rows keyed by `appNum` |
| `reports/{num}-*.md` | rendered report (incl. Machine Summary YAML) |
| `jds/`, `interview-prep/{slug}/jd.md` | job description text |
| `interview-prep/{slug}/` | prep files, `page.yml`, `resume.pdf` |
| `data/pipeline.md` | inbox count |
| shell-outs: `stats.mjs`, `followup-cadence.mjs`, `salary-gap.mjs`, `detect-reposts.mjs` | canonical funnel, due follow-ups, comp gap, reposts (JSON) |

Missing-file behavior: every reader degrades to empty + a per-source warning
chip in the UI, never a 500. A resume path that doesn't exist on the LXC
renders as filename + "not synced" note.

## 7. Pages & routes

- **`/` Overview** — funnel tiles Evaluated → Applied → Responded → Interview
  → Offer → Hired/Rejected with stage-to-stage conversion %, response rate,
  today vs 10/day apply quota, upcoming interviews with countdowns,
  follow-ups due, recent activity (status-log tail), pipeline inbox count.
- **`/apps`** — filter (status, score band, company, text search), sortable
  columns, count of matches. Row links to detail.
- **`/apps/{num}`** — facts header (company, role, score, status, via, dates);
  status timeline; tabs: Report / JD / Resume used (inline PDF when present) /
  Contacts & follow-ups; status dropdown → POST → `set-status.mjs` (§9).
- **`/contacts`** — phonebook grouped by company, linked to applications.
- **`/prep`** — tabbed page of all upcoming interviews (artifact layout:
  sticky tab bar + shared countdown line); past interviews in an archive list.
  `/prep/{slug}` per interview.
- **`/chat`** — agent console (§10).
- **`/api/*`** — JSON endpoints backing the pages; `/api/events` (SSE) pushes
  `data-changed` (from fs.watch) and agent output streams.

All pages server-rendered from `views/`, styled by `assets/hub.css` — the
design tokens, tabs, countdown, numbered collapsible sections, and
verified/reasoned/forbidden flag vocabulary from the approved artifact, with
its existing light/dark behavior. Live updates: pages subscribe to
`/api/events` and refresh their data region when a relevant file changes.

## 8. Interview-prep pipeline

- **Source of truth per interview:** `interview-prep/{slug}/page.yml` —
  structured, agent- or hand-editable, synced like everything else.

```yaml
meta:
  company: Magnet Forensics
  role: Software Development Engineer in Test
  tracker: 739
  round: Hiring manager
  datetime: 2026-08-12T11:00:00-06:00     # ISO with offset; drives countdown
  duration_min: 45
  platform: "Microsoft Teams · ID 261 575 864 770 912"
  interviewer: "Shannon Cox · Quality Engineering Director"
sections:                                  # ordered; block types match the artifact
  - {type: facts, items: [...]}
  - {type: proof, title: Lead with this, body: ...}
  - {type: say, n: "01", title: Opening answer, label: Say this, paras: [...]}
  - {type: reasoned|forbid|proof, ...}     # epistemic flags
  - {type: stories, ...}
  - {type: questions, items: [...]}
```

- **Renderer:** `node hub/gen-prep.mjs [slug]` — deterministic page.yml →
  HTML; also invoked automatically by the server when `page.yml` mtime is
  newer than the cached render. No LLM in the render path.
- **Authoring:** converting an existing free-form `prep.md` into `page.yml`
  is agent work using `hub/prep-page-mode.md` as the prompt — run from any
  session or by asking the hub chatbot ("build the prep page for magnet").
  The prompt enforces the source-of-truth boundary: content only from the
  prep files/tracker, epistemic flags preserved.
- Interviews whose `datetime` is past drop off the `/prep` tab bar into the
  archive automatically.

## 9. Writes (non-chatbot)

Exactly one: the status dropdown POSTs to the hub, which runs
`node set-status.mjs <num> <State> [--note]` locally on the LXC — the
canonical locked, validated, atomic writer. Syncthing propagates the result
to Mac + NAS. The hub takes a process-level mutex so a status write and an
agent run never interleave.

## 10. Chatbot / agent console

- POST message → server spawns a worker in the LXC repo root:
  default `codex exec "<prompt>"`; UI toggle for `claude -p "<prompt>"`
  (fallback per the user's codex-unavailable rule). stdout/stderr stream to
  the browser over SSE; kill button terminates the process group.
- **One run at a time** (same mutex as §9) — queued messages wait; prevents
  tracker write races entirely on the LXC side.
- Workers read `AGENTS.md`/repo rules as usual: source-of-truth boundary,
  never-submit, canonical writers (`set-status.mjs`, TSV + `merge-tracker.mjs`).
  The hub adds a system preamble to every prompt restating: no submissions,
  no pushes, writes only via canonical writers.
- Transcripts append to `hub/logs/<date>.md` (gitignored, not synced).
- Auth required (§11); the chat endpoints are the highest-risk surface —
  they are RCE by design, so they must never be reachable unauthenticated.

## 11. Auth & security

- Single shared secret `HUB_TOKEN` (env file read by systemd unit). Login
  page sets an HttpOnly cookie (SHA-256 of token); every route except
  `/login` requires it. Constant-time compare.
- Binds `0.0.0.0` on the LXC but the network boundary is the LAN; no port
  forwarding. No secrets in the repo; env file lives on the LXC only.
- The hub never handles GitHub credentials (it never touches git).

## 12. Error handling summary

| Failure | Behavior |
|---------|----------|
| Sync conflict files appear | Persistent red banner with file list; hub keeps serving |
| Source file missing/unparseable | Section renders empty + warning chip; log line |
| Agent spawn fails (CLI missing, auth expired) | Chat shows the exact stderr; suggests the claude/codex toggle |
| Agent exceeds 30 min | Auto-kill, transcript notes it |
| set-status.mjs nonzero exit | Dropdown reverts, stderr shown inline |
| Resume PDF absent on LXC | "not synced" note instead of embed |

## 13. Testing

- `tests/hub/data.test.mjs` — joins across fixture copies of the five sources;
  funnel/conversion math against a known fixture tracker.
- `tests/hub/prep-render.test.mjs` — page.yml fixture → HTML snapshot
  (structure assertions, countdown datetime attribute, flag classes).
- `tests/hub/server.test.mjs` — route smoke tests against fixtures: auth
  gate (401 without cookie), overview JSON shape, set-status mutex.
- Manual smoke checklist in `deploy/README.md`: SSE liveness (edit a file,
  watch the page), chat run end-to-end, conflict banner (forge a
  `sync-conflict` file).
- Full `node test-all.mjs` must stay green (hub tests ride the auto-discovery).

## 14. Implementation prerequisites (verify before build)

1. Codex CLI and Claude CLI installed + authenticated on LXC 114 (headless).
2. Node ≥ 20 on the LXC.
3. Syncthing installable on all three nodes (TrueNAS catalog app on NAS).
4. Confirm nothing named "<potentially-conflicting-service>" on your NAS conflicts with the new
   dataset (nothing found running as of 2026-08-10; user to confirm what/where
   it is — isolation via dedicated dataset makes collision unlikely regardless).

## 15. Decisions log

| Decision | Choice |
|----------|--------|
| Deployment | Homelab LXC 114, LAN-wide |
| Sync | Syncthing 3-node via NAS dataset `/mnt/Data/career-ops`; git out of live path; ZFS snapshots for history |
| Audience | Personal-only, `hub/`, private remotes |
| Stack | Single Node server, stdlib http, no build step, server-rendered + vanilla JS |
| Database | None; files canonical, mtime cache; derived SQLite allowed later if ever needed |
| Chatbot default | codex, claude toggle |
| Prep pages | page.yml per interview + deterministic renderer + agent authoring prompt |
