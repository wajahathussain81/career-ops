import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { loadPrepPage } from './lib/data.mjs';
import { mdToHtml } from './lib/md.mjs';
import { escapeHtml } from './views/layout.mjs';

const SECTION_LABELS = {
  facts: 'Facts',
  flag: 'Callout',
  say: 'Say this',
  list: 'Notes',
  stories: 'Stories',
  questions: 'Questions',
};

function field(value) {
  return escapeHtml(value ?? '');
}

function markdown(value) {
  return mdToHtml(String(value ?? ''));
}

function prepFile(root, slug, filename) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(String(slug ?? ''))) return null;
  return resolve(root, 'interview-prep', slug, filename);
}

export function defaultQaQuestions(meta = {}) {
  const company = String(meta?.company ?? '').trim();
  return [
    {
      id: 'gen-tell-me-about-yourself',
      q: 'Tell me about yourself.',
      source: 'agent',
      agent_answer: '',
      answer: '',
    },
    {
      id: 'gen-why-company',
      q: company ? `Why do you want to work at ${company}?` : 'Why do you want to work here?',
      source: 'agent',
      agent_answer: '',
      answer: '',
    },
    {
      id: 'gen-why-this-role',
      q: 'Why are you interested in this role?',
      source: 'agent',
      agent_answer: '',
      answer: '',
    },
    {
      id: 'gen-why-leaving',
      q: 'Why are you leaving your current role / what are you looking for next?',
      source: 'agent',
      agent_answer: '',
      answer: '',
    },
    {
      id: 'gen-strengths-weaknesses',
      q: 'What are your greatest strengths, and what is a weakness you are working on?',
      source: 'agent',
      agent_answer: '',
      answer: '',
    },
    {
      id: 'gen-questions-for-them',
      q: 'What questions do you have for us?',
      source: 'agent',
      agent_answer: '',
      answer: '',
    },
  ];
}

function questionPrefix(value) {
  return String(value ?? '').trim().toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '');
}

function withDefaultQaQuestions(qa, meta) {
  const staples = defaultQaQuestions(meta);
  const sections = Array.isArray(qa?.sections) ? qa.sections : [];
  if (!sections.length) return { sections: [{ title: 'General', questions: staples }] };

  const questions = sections.flatMap(section => Array.isArray(section?.questions)
    ? section.questions
    : []);
  const missing = staples.filter(staple => {
    const prefix = questionPrefix(staple.q);
    return !questions.some(question => String(question?.id ?? '') === staple.id
      || questionPrefix(question?.q).startsWith(prefix));
  });

  const general = sections.find(section => section && typeof section === 'object'
    && !Array.isArray(section)
    && String(section.title ?? '').trim().toLocaleLowerCase() === 'general');
  const tellPrefix = questionPrefix(staples[0].q);
  const isTellQuestion = question => String(question?.id ?? '') === staples[0].id
    || questionPrefix(question?.q).startsWith(tellPrefix);
  const generalQuestions = Array.isArray(general?.questions) ? general.questions : [];
  const tellIndex = generalQuestions.findIndex(isTellQuestion);
  let tellQuestion = tellIndex >= 0 ? generalQuestions[tellIndex] : null;

  if (!tellQuestion) {
    for (const section of sections) {
      if (section === general || !Array.isArray(section?.questions)) continue;
      const index = section.questions.findIndex(isTellQuestion);
      if (index >= 0) {
        [tellQuestion] = section.questions.splice(index, 1);
        break;
      }
    }
  }
  if (!tellQuestion) tellQuestion = missing.find(isTellQuestion) ?? staples[0];

  const remainingQuestions = tellIndex >= 0
    ? generalQuestions.filter((_question, index) => index !== tellIndex)
    : generalQuestions;
  const otherMissing = missing.filter(question => question !== tellQuestion
    && !isTellQuestion(question));
  if (general) {
    general.questions = [
      tellQuestion,
      ...remainingQuestions,
      ...otherMissing,
    ];
  } else {
    sections.unshift({ title: 'General', questions: [tellQuestion, ...otherMissing] });
  }
  return qa;
}

export function loadPrepQa(root, slug, meta = {}) {
  const absPath = prepFile(root, slug, 'qa.yml');
  if (!absPath || !existsSync(absPath)) return withDefaultQaQuestions(null, meta);

  try {
    const parsed = yaml.load(readFileSync(absPath, 'utf8'), { schema: yaml.JSON_SCHEMA });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !Array.isArray(parsed.sections)) return withDefaultQaQuestions(null, meta);
    return withDefaultQaQuestions(parsed, meta);
  } catch {
    return withDefaultQaQuestions(null, meta);
  }
}

export function loadPrepNotes(root, slug) {
  const absPath = prepFile(root, slug, 'notes.md');
  if (!absPath || !existsSync(absPath)) return '';

  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

export function formatPrepDatetime(value) {
  const source = String(value ?? '');
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) {
    const date = new Date(source);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : source;
  }

  const [, year, month, day, hour, minute, offset] = match;
  const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const weekday = new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(calendarDate);
  const monthName = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(calendarDate);
  const zone = offset === 'Z' ? 'UTC' : `UTC${offset}`;
  return `${weekday} ${monthName} ${Number(day)}, ${year} · ${hour}:${minute} ${zone}`;
}

function renderFacts(items) {
  return `<ul class="facts">${(Array.isArray(items) ? items : []).map(item =>
    `<li><span class="fk">${field(item?.k)}</span><span class="fv">${field(item?.v)}</span></li>`
  ).join('')}</ul>`;
}

function renderFlag(section) {
  const kind = ['proof', 'reasoned', 'forbid'].includes(section.kind) ? section.kind : 'reasoned';
  return `<div class="flag ${kind}">
  <span class="flag-t">${field(section.title)}</span>
  ${markdown(section.body)}
</div>`;
}

function renderSay(section) {
  const label = section.label ? `<span class="say-label">${field(section.label)}</span>` : '';
  const paras = (Array.isArray(section.paras) ? section.paras : []).map(markdown).join('\n');
  return `<blockquote class="say">${label}${paras}</blockquote>`;
}

function renderList(items, ordered = false) {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${(Array.isArray(items) ? items : []).map(item =>
    `<li>${markdown(item)}</li>`
  ).join('')}</${tag}>`;
}

function renderStories(stories) {
  return (Array.isArray(stories) ? stories : []).map((story, index) => {
    const rows = [
      ['S', story?.s],
      ['T', story?.t],
      ['A', story?.a],
      ['R', story?.r],
      ...(story?.reflection ? [['Reflection', story.reflection]] : []),
    ];
    const boundary = story?.boundary ? `<div class="flag forbid">
  <span class="flag-t">Boundary</span>
  ${markdown(story.boundary)}
</div>` : '';
    return `<h3>${index + 1} · ${field(story?.title)}</h3>
<ul>${rows.map(([label, value]) =>
    `<li><strong>${label}</strong> — ${markdown(value)}</li>`
  ).join('')}</ul>
${boundary}`;
  }).join('\n');
}

function sectionBody(section) {
  switch (section?.type) {
    case 'facts': return renderFacts(section.items);
    case 'flag': return renderFlag(section);
    case 'say': return renderSay(section);
    case 'list': return renderList(section.items);
    case 'stories': return renderStories(section.stories);
    case 'questions': return renderList(section.items, true);
    default: return '';
  }
}

function sectionTitle(section) {
  return section?.title || SECTION_LABELS[section?.type] || 'Section';
}

export function renderPrepPage(page) {
  if (!page?.meta || !Array.isArray(page.sections)) return '';
  const meta = page.meta;
  const datetime = String(meta.datetime ?? '');
  const facts = [
    ['When', formatPrepDatetime(datetime)],
    ['Duration', meta.duration_min == null ? '' : `${meta.duration_min} min`],
    ['Platform', meta.platform],
    ['Interviewer', meta.interviewer],
    ['Countdown', `<span class="countdown" data-dt="${field(datetime)}"></span>`],
  ].filter(([, value]) => value !== '' && value != null);

  const mastheadFacts = `<ul class="facts">${facts.map(([key, value]) =>
    `<li><span class="fk">${field(key)}</span><span class="fv">${key === 'Countdown' ? value : field(value)}</span></li>`
  ).join('')}</ul>`;
  const toc = `<nav class="prep-toc" aria-label="Prep sections">
  <p class="eyebrow">Sections</p>
  <ol>${page.sections.map((section, index) => `<li><a href="#sec-${index + 1}"><span class="prep-toc-n">${String(index + 1).padStart(2, '0')}</span><span>${field(sectionTitle(section))}</span></a></li>`).join('')}</ol>
</nav>`;
  const sections = page.sections.map((section, index) => {
    const wide = ['stories', 'say'].includes(section?.type) ? ' sec-wide' : '';
    return `<section class="sec${wide}" id="sec-${index + 1}">
  <header class="sec-head"><span class="sec-n">${String(index + 1).padStart(2, '0')}</span><h2 class="sec-t">${field(sectionTitle(section))}</h2></header>
  <div class="sec-body">${sectionBody(section)}</div>
</section>`;
  }).join('\n');

  return `<div class="prep-shell">
  <aside class="prep-rail">
    <header class="head">
      <p class="eyebrow">${field(meta.round)} · Tracker #${field(meta.tracker)}</p>
      <h1>${field(meta.company)}</h1>
      <p class="prep-role">${field(meta.role)}</p>
      ${mastheadFacts}
    </header>
    ${toc}
  </aside>
  <div class="prep-main">
    ${sections}
  </div>
</div>`;
}

function renderAddQuestion(sectionTitle) {
  return `<form class="prep-add-question" data-prep-question-form data-section="${field(sectionTitle)}">
  <label class="micro-label">Add a question
    <input type="text" name="q" autocomplete="off" placeholder="What do you want to ask?" data-prep-add-input>
  </label>
  <button type="submit">Add</button>
  <span class="prep-save-state" data-prep-add-state aria-live="polite"></span>
</form>`;
}

function renderQaQuestion(question) {
  const id = String(question?.id ?? '');
  const source = question?.source === 'user' ? 'user' : 'agent';
  const agentAnswer = String(question?.agent_answer ?? '');
  const agentBody = agentAnswer.trim()
    ? markdown(agentAnswer)
    : '<p class="prep-agent-answer-empty">No agent response yet — ask the agent to draft one.</p>';
  return `<article class="prep-qa-card" data-question-id="${field(id)}">
  <header class="prep-qa-card-head">
    <p class="prep-question-text">${field(question?.q)}</p>
    <span class="prep-source-badge source-${source}">${field(source)}</span>
  </header>
  <div class="prep-agent-answer"><span class="prep-answer-label">AGENT</span>${agentBody}</div>
  <form data-prep-answer-form>
    <span class="prep-answer-label">YOU</span>
    <textarea name="answer" data-prep-editor data-prep-answer data-question-id="${field(id)}" aria-label="Answer to ${field(question?.q)}" placeholder="Draft your answer in Markdown…">${field(question?.answer)}</textarea>
    <div class="prep-save-row">
      <span class="prep-save-state" data-prep-save-state data-state="saved" aria-live="polite">SAVED</span>
      <button type="submit" data-prep-save-answer>Save answer</button>
    </div>
  </form>
</article>`;
}

export function renderPrepQa(qa) {
  const sections = (Array.isArray(qa?.sections) ? qa.sections : [])
    .filter(section => section && typeof section === 'object' && !Array.isArray(section));
  const displaySections = sections.length ? sections : [{ title: 'My questions', questions: [], empty: true }];

  return `<div class="prep-main prep-qa-main">${displaySections.map((section, index) => {
    const title = String(section.title || 'Questions');
    const questions = (Array.isArray(section.questions) ? section.questions : [])
      .filter(question => question && typeof question === 'object'
        && !Array.isArray(question) && String(question.id ?? ''));
    const emptyCopy = section.empty
      ? '<p class="prep-qa-empty-copy">Your interview-prep agent seeds researched questions here. Add your own now, and future questions will appear in this workspace.</p>'
      : '';
    return `<section class="sec sec-wide${section.empty ? ' prep-qa-empty' : ''}">
  <header class="sec-head"><span class="sec-n">${String(index + 1).padStart(2, '0')}</span><h2 class="sec-t">${field(title)}</h2></header>
  <div class="sec-body prep-qa-section-body">
    ${emptyCopy}
    <div class="prep-question-list" data-prep-question-list>${questions.map(renderQaQuestion).join('\n')}</div>
    ${renderAddQuestion(title)}
  </div>
</section>`;
  }).join('\n')}</div>`;
}

export function renderPrepNotes(notes, slug) {
  return `<section class="prep-notes" data-prep-notes data-prep-slug="${field(slug)}">
  <header class="prep-notes-head">
    <p class="eyebrow">Workspace</p>
    <h2>Notes</h2>
  </header>
  <form data-prep-notes-form>
    <label class="sr-only" for="prep-notes-${field(slug)}">Interview notes</label>
    <textarea id="prep-notes-${field(slug)}" name="notes" data-prep-editor data-prep-notes-editor placeholder="Capture questions, reminders, and free-form notes in Markdown…">${field(notes)}</textarea>
    <div class="prep-save-row">
      <span class="prep-save-state" data-prep-save-state data-state="saved" aria-live="polite">SAVED</span>
      <button type="submit" data-prep-save-notes>Save notes</button>
    </div>
  </form>
</section>`;
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  const slug = process.argv[2];
  const root = process.env.HUB_ROOT || process.cwd();
  const page = slug ? loadPrepPage(root, slug) : null;
  if (!page) {
    console.error(`Unknown prep page: ${slug || '(missing slug)'}`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${renderPrepPage(page)}\n`);
  }
}
