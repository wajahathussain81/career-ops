import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
    ['Company', meta.company],
    ['When', formatPrepDatetime(datetime)],
    ['Duration', meta.duration_min == null ? '' : `${meta.duration_min} min`],
    ['Platform', meta.platform],
    ['Interviewer', meta.interviewer],
    ['Countdown', `<span class="countdown" data-dt="${field(datetime)}"></span>`],
  ].filter(([, value]) => value !== '' && value != null);

  const mastheadFacts = `<ul class="facts">${facts.map(([key, value]) =>
    `<li><span class="fk">${field(key)}</span><span class="fv">${key === 'Countdown' ? value : field(value)}</span></li>`
  ).join('')}</ul>`;
  const sections = page.sections.map((section, index) => `<details class="sec"${index === 0 ? ' open' : ''}>
  <summary><span class="sec-n">${String(index + 1).padStart(2, '0')}</span><span class="sec-t">${field(sectionTitle(section))}</span><span class="chev">›</span></summary>
  <div class="sec-body">${sectionBody(section)}</div>
</details>`).join('\n');

  return `<header class="head">
  <p class="eyebrow">${field(meta.round)} · Tracker #${field(meta.tracker)}</p>
  <h1>${field(meta.role)}</h1>
  ${mastheadFacts}
</header>
${sections}`;
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
