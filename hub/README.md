# career-ops hub

The hub is a local web dashboard over the files in a career-ops checkout. It
uses no database: views are built directly from the project's Markdown, TSV,
and generated application artifacts.

## Run locally

Set a private session token, then start the server from the repository root:

```bash
export HUB_TOKEN="replace-with-a-private-token"
node hub/server.mjs
```

Open [http://127.0.0.1:8484](http://127.0.0.1:8484) and sign in with that token.

## Pages

- **Overview** - Shows the application funnel and today's application quota.
- **Apps** - Presents the canonical application tracker with status and role
  details.
- **Packages** - Lists built resumes and cover letters, provides the posting's
  Apply link, and offers a one-click mark-applied action that updates status and
  seeds the first follow-up.
- **Prep** - Opens interview preparation pages and question banks.
- **Archive** - Browses transcripts from past interviews.
- **Chat** - Provides a live console that streams events from supported AI CLIs.
- **Contacts** - Lists recruiters and other job-search contacts, with vCard
  export for a phone or address book.

## One source of truth

The hub reads the same canonical Markdown and TSV files written by the
career-ops CLI. Actions that change state write back through those established
files and scripts, so the dashboard never becomes a second source of truth.
