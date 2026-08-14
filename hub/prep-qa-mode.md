# Interview prep Q&A authoring mode

Create `interview-prep/{slug}/qa.yml` for the Career Ops Hub.

For question generation, read only these factual sources:

- `interview-prep/{slug}/prep*.md`
- `interview-prep/{slug}/jd.md`
- `interview-prep/question-bank.md`
- `interview-prep/story-bank.md`

Emit only `qa.yml`. Do not add commentary, research, or any other file. Every question must be grounded in the allowed question sources. When generating questions, do not import claims from memory, other prep directories, reports, the CV, the web, or general knowledge.

The `General` section is mandatory, must come first, and must contain these staple questions with these stable IDs and exact wording:

The first question must be verbatim `Tell me about yourself.` as a standalone question. Never extend or specialize it with a role-specific, company-specific, or experience-specific tail. Apply the same no-embellishment rule to every other staple: keep the canonical phrasing from `defaultQaQuestions` exactly.

- `gen-tell-me-about-yourself` — `Tell me about yourself.`
- `gen-why-company` — `Why do you want to work at {company}?` Use `Why do you want to work here?` when the company is empty.
- `gen-why-this-role` — `Why are you interested in this role?`
- `gen-why-leaving` — `Why are you leaving your current role / what are you looking for next?`
- `gen-strengths-weaknesses` — `What are your greatest strengths, and what is a weakness you are working on?`
- `gen-questions-for-them` — `What questions do you have for us?`

The schema is:

```yaml
sections:
  - title: string
    questions:
      - id: kebab-case string
        q: string
        source: agent
        agent_answer: ""
        answer: ""
```

Every question ID must be kebab-case and unique within the file. Preserve the stable General IDs exactly so candidate answers survive re-seeding. Seed both `agent_answer` and `answer` as `""`.

`agent_answer` is optional agent-authored Markdown. It may be drafted or refined only by the agent editing `qa.yml` directly, never through the Hub answer endpoint. Ground every claim in source-of-truth material: `cv.md`, `interview-prep/story-bank.md`, the prep documents for this interview, or statements and answers the user provided directly. Missing or empty `agent_answer` is normal.

`answer` always contains the user's own words. The agent must never write, replace, or overwrite it. When the user asks for a draft or refinement, write only `agent_answer` and preserve `answer` exactly.

After General, add only interview-specific sections supported by the prep documents, JD, `question-bank.md`, or `story-bank.md`. Questions may ask the candidate to prepare supported experience, but must not imply unsupported achievements. Never invent interview logistics, company facts, role facts, or candidate claims. If a fact is absent from the allowed sources, omit the question or phrase it without asserting that fact.

Full example:

```yaml
sections:
  - title: General
    questions:
      - id: gen-tell-me-about-yourself
        q: Tell me about yourself.
        source: agent
        agent_answer: ""
        answer: ""
      - id: gen-why-company
        q: Why do you want to work at Acme Robotics?
        source: agent
        agent_answer: ""
        answer: ""
      - id: gen-why-this-role
        q: Why are you interested in this role?
        source: agent
        agent_answer: ""
        answer: ""
      - id: gen-why-leaving
        q: Why are you leaving your current role / what are you looking for next?
        source: agent
        agent_answer: ""
        answer: ""
      - id: gen-strengths-weaknesses
        q: What are your greatest strengths, and what is a weakness you are working on?
        source: agent
        agent_answer: ""
        answer: ""
      - id: gen-questions-for-them
        q: What questions do you have for us?
        source: agent
        agent_answer: ""
        answer: ""
  - title: Technical
    questions:
      - id: technical-release-evidence
        q: How do you make release evidence repeatable?
        source: agent
        agent_answer: ""
        answer: ""
```

Before emitting, verify that General comes first with all six stable IDs, every other question traces to an allowed source, every ID is unique kebab-case, every source is `agent`, and every `agent_answer` and `answer` is empty. When separately asked to draft agent responses, verify their grounding and confirm every user `answer` remains unchanged.
