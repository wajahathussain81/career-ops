---
description: Voice mock interview — questions spoken aloud, answers via local mic + whisper, per-answer coaching with delivery metrics
---

# /mock — Voice Mock Interview

Argument: a company or prep-folder fragment (e.g. `magnet`, `autodesk`).

## Setup
1. Resolve the prep folder: match the argument against `interview-prep/*/` directories (each contains `prep.md`, `jd.md`, `resume.pdf`). No match: list available folders and stop.
2. Read that folder's `prep.md` and `jd.md`, plus `interview-prep/question-bank.md` and `interview-prep/story-bank.md` if they exist. Calibrate the session to the NEXT round type indicated by the prep doc's debrief section (recruiter screen / hiring manager / technical peers / executive). Check `node salary-gap.mjs --stated-for <report#>` for previously stated comp numbers and stay consistent with them.

## Session loop (5–8 questions)
Sequence: opener → JD-specific → gap probes (🔴 then 🟡 from the question bank first — real performance data outranks inferred risk) → behavioral → comp (only if round-appropriate) → "questions for me?".

For each question:
1. Speak it aloud: run `~/bin/voice-say "<question text>"` via Bash, AND print it prefixed `🎤`.
2. Tell the candidate to answer with `! ~/bin/talk --max <N>` — 30s for warm-ups, 90–120s for substantive answers. NEVER suggest plain `! ~/bin/talk` without `--max` (keypresses background the command in this harness; only timed mode is reliable).
3. When the transcript + metrics arrive, give: one thing that landed, one concrete fix, and a delivery note from the metrics (target 130–160 WPM; flag drift beyond ±25; flag pauses >1.5s at content-critical moments; flag filler rate >3/min). Keep coaching to ~6 lines per answer.

## Hard rules
- Never put invented claims in the candidate's mouth — suggested phrasings must trace to `cv.md`, the prep doc, or the story bank. Respect every ownership boundary stated in the prep doc (e.g. NVision IV and bed-of-nails scopes for Magnet/Autodesk).
- Comp coaching must match the stated numbers from `data/salary-observations.tsv` for that company.
- Mock transcripts are practice, not real rounds: do NOT write files into `interview-prep/sessions/` (that directory is for real interviews only).

## Wrap-up
Scorecard: per-question ✅/🟡/🔴 with one-line reasons; top 2 fixes to rehearse; then update `interview-prep/question-bank.md` statuses for any question that materially improved or regressed (mark entries `(mock 〈date〉)`).

## Troubleshooting
- Silent transcript: mic device issue — `talk` records from the system default input; `TALK_MIC` env overrides (e.g. `TALK_MIC="External Microphone"`). Device `:0` (Microsoft Teams Audio) is a silent virtual device — never use it. Run `~/bin/voice-mock-setup.sh` for a health check.
