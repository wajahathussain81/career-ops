---
description: Morning briefing — sync homelab nightly work, email-check results, pipeline status, today's plan
---

# /daily — Session briefing

Run these steps in order, then end with ONE compact briefing message. Propose tracker changes — never auto-apply them without user confirmation.

## 1. Sync the homelab (pull-based — always do this first)
- Run `git fetch <your-automation-remote>` (replace the placeholder with your nightly remote).
- If behind: `git merge --ff-only <your-automation-remote>/<your-automation-branch>`; if the branches diverged, do a regular merge with message "merge automated nightly runs".
- Note which nightly commits arrived (daily scan / nightly eval / daily email check) and which new `reports/*.md` files appeared. For each new report, grab report #, company, and its `**Score:**` line.

## 2. Update check (silent)
- Run `node update-system.mjs check`. Mention it only if status is `update-available`.

## 3. Email-check results
- Read the `data/email-updates/*.md` file(s) that are new since the last briefing (everything the merge brought in; at minimum today's file if it exists).
- Report ONLY actionable items: Rejected, Interview, Need Action / assessment invites, and Unknowns that name a company already in the tracker. For Noise and Auto-confirmation items, report a count only.
- Cross-check each "Suggested status update" against `data/applications.md`: label it **already applied** or **pending**. For pending ones, show the exact command `node set-status.mjs <report#> <State> --note "..."` as a proposal and wait for the user's go-ahead.
- **Live Gmail check (always):** the nightly file only covers mail up to the nightly run. After reading it, search Gmail directly (mcp__claude_ai_Gmail__search_threads, e.g. `newer_than:1d` plus queries for tracker companies / ATS senders like greenhouse.io, lever.co, ashbyhq.com, myworkday.com, icims.com, paradox.ai) for anything newer than the nightly file. Classify new messages the same way (Rejected / Interview / Need Action / Auto-confirmation / Noise), fold actionable ones into the 📧 section marked **(live)**, and propose — never auto-apply — any tracker updates. If the Gmail MCP connection is unavailable, say so in one line rather than skipping silently.

## 4. Pipeline stats
- Run `node stats.mjs --summary`. Report the Tracker and Funnel lines only.

## 5. Follow-ups
- Run `node followup-cadence.mjs --summary`. List OVERDUE rows and rows due today or tomorrow.

## 6. Agent inbox
- Read `data/agent-inbox.md`. List all unchecked items and any deadlines they mention.

## 7. Daily apply quota (10/day)
- Count tracker rows in `data/applications.md` dated today with status Applied. Report "X/10 applied today".
- List the top 5 unapplied `Evaluated` rows scoring ≥3.5 (highest score first) as today's apply candidates.

## 8. Interviews
- Grep `data/applications.md` for `| Interview |` rows and extract any scheduled date/time from the notes column. Anything within the next 48 hours goes at the TOP of the briefing.

## Briefing format
Order: 🎯 Time-critical (interviews <48h, deadlines) → 📧 Email check (nightly file + live Gmail; actionable items + proposed tracker updates) → 📊 Pipeline (stats + new nightly reports) → ⏰ Follow-ups due → 📥 Inbox tasks → ▶ Suggested plan for today (quota candidates + queued tasks, in order).
Keep the briefing under ~40 lines. Lead with anything happening today.
