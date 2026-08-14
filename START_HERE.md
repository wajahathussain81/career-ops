# Start Here

Welcome — this is your own career-ops workspace. It is an open-source AI job-search system that scans job boards, scores postings against your CV with an A–F rubric, tailors CVs, and tracks applications. This copy also includes the `hub/` web dashboard, a `/daily` morning briefing, a `/mock` voice mock interview, and optional advanced automation in `batch/headless/` for running scans on a home server.

## Prerequisites

You need:

- Node.js 20 or newer
- Git
- An AI coding CLI — Claude Code is recommended; Codex and OpenCode also work

If cost matters, there is a free-tier path in [docs/FREE_TIER.md](docs/FREE_TIER.md).

## Set up in four steps

1. Clone the repository:

   ```sh
   git clone -b hub https://github.com/wajahathussain81/career-ops.git
   cd career-ops
   ```

2. Install the dependencies:

   ```sh
   npm install
   ```

3. Open the folder in Claude Code:

   ```sh
   claude
   ```

4. Say:

   > set me up

The built-in onboarding will walk you through creating your CV, profile, and job-board list. Nothing personal ships in this repository; everything about you stays in local files that Git ignores.

## Daily use

- Paste any job URL into your AI coding CLI to evaluate it.
- Run `/career-ops scan` to sweep your configured job boards.
- Run `/daily` for your morning briefing.
- Run `/mock <company>` when you want a voice mock interview.

To start the hub locally from the repository root, run:

```sh
HUB_TOKEN='replace-with-a-long-random-secret' node hub/server.mjs
```

Then open [http://127.0.0.1:8484](http://127.0.0.1:8484). Port `8484` is the server default; advanced home-server deployment instructions are in [hub/deploy/README.md](hub/deploy/README.md).

## Privacy

Your CV, application tracker, reports, and other user-layer files stay local and are ignored by Git. The system never commits them, but you should still check what is staged and never push personal job-search data to a public remote.
