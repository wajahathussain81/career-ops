# Interview prep page authoring mode

Create `interview-prep/{slug}/page.yml` for the Career Ops Hub.

Read only these factual sources:

- `interview-prep/{slug}/prep*.md`
- The matching tracker row in `data/applications.md`

Emit only `page.yml`. Do not add commentary, research, or any other file. Every content claim must come exclusively from those source files. Do not import claims from memory, other prep directories, reports, the CV, the web, or general knowledge.

Preserve the source's epistemic status exactly:

- verified content → `kind: proof`
- reasoned or inferred content → `kind: reasoned`
- forbidden claims, hard boundaries, and “do not say” content → `kind: forbid`

Never invent interview logistics. Company, role, tracker number, round, datetime, duration, platform, and interviewer must be stated in the allowed sources. If a logistics field is unknown, leave it empty rather than guessing. A populated `meta.datetime` must be ISO 8601 and carry an explicit UTC offset, for example `2030-01-15T11:00:00-07:00`; never emit a timezone-free datetime.

The schema is:

```yaml
meta:
  company: string
  role: string
  tracker: number
  round: string
  datetime: ISO-8601 string with UTC offset
  duration_min: number
  platform: string
  interviewer: string
sections:
  - type: facts
    items: [{ k: string, v: string }]
  - type: flag
    kind: proof | reasoned | forbid
    title: string
    body: markdown string
  - type: say
    title: string
    label: optional string
    paras: [markdown string]
  - type: list
    title: string
    items: [markdown string]
  - type: stories
    stories:
      - title: string
        s: markdown string
        t: markdown string
        a: markdown string
        r: markdown string
        reflection: optional markdown string
        boundary: optional markdown string
  - type: questions
    items: [markdown string]
```

Use only the section types that the source material supports. Keep wording concise enough to use during an interview. Markdown is supported in `body`, list/question items, spoken paragraphs, and story fields.

Full example:

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
  - type: facts
    items:
      - k: Focus
        v: Embedded delivery and test automation
      - k: Format
        v: Technical conversation
  - type: flag
    kind: proof
    title: Lead with this
    body: You built the **CI pipeline**.
  - type: flag
    kind: reasoned
    title: Calibration only
    body: This topic is likely, but the source does not confirm it.
  - type: say
    title: Opening answer
    label: Say this
    paras:
      - I am an embedded engineer.
      - I built the pipeline.
  - type: list
    title: Topics to cover
    items:
      - Firmware validation
      - Repeatable **release evidence**
  - type: stories
    stories:
      - title: CI pipeline
        s: Releases were manual.
        t: Make delivery repeatable.
        a: Built and documented the pipeline.
        r: Deployment time fell by **30%**.
        reflection: Visible signals make a pipeline trustworthy.
        boundary: Do not claim ownership of infrastructure built by other team members.
  - type: questions
    items:
      - Why is the role open?
      - What would success look like after six months?
  - type: flag
    kind: forbid
    title: Never say
    body: Do not claim experience the source files explicitly deny.
```

Before emitting, verify that every sentence can be traced to `prep*.md` or the tracker row, every epistemic label is preserved, and the datetime includes its UTC offset.
