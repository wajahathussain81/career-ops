import { existsSync, readFileSync } from 'node:fs';
import {
  formatPrepDatetime,
  renderPrepNotes,
  renderPrepPage,
  renderPrepQa,
} from '../gen-prep.mjs';
import { mdToHtml } from '../lib/md.mjs';
import { escapeHtml } from './layout.mjs';

function hrefFor(slug) {
  return `/prep/${encodeURIComponent(slug)}`;
}

function renderJobDescription(jdFile) {
  return jdFile && existsSync(jdFile)
    ? `<div class="prep-prose">${mdToHtml(readFileSync(jdFile, 'utf8'))}</div>`
    : '<div class="prep-prose"><p class="eyebrow">No job description on file</p></div>';
}

function renderResume(resumeUrl) {
  return resumeUrl
    ? `<a href="${escapeHtml(resumeUrl)}" target="_blank" rel="noopener">Open resume PDF ↗</a>
    <embed class="prep-resume-embed" src="${escapeHtml(resumeUrl)}" type="application/pdf" width="100%">`
    : '<p class="eyebrow">No resume on file</p>';
}

function renderContentTabs(entry, idPrefix) {
  const tabs = ['Prep', 'Questions', 'Job description', 'Resume'];
  const panes = [
    renderPrepPage(entry.page),
    renderPrepQa(entry.qa),
    renderJobDescription(entry.jdFile),
    renderResume(entry.resumeUrl),
  ];
  const paneClasses = [
    'prep-material-prep',
    'prep-material-qa',
    'prep-material-jd',
    'prep-material-resume',
  ];

  return `<div class="tabs prep-material-tabs" role="tablist" aria-label="Interview materials">${tabs.map((tab, index) => `<button class="tab" id="${idPrefix}-tab-${index}" type="button" role="tab" aria-selected="${index === 0}" aria-controls="${idPrefix}-${index}" tabindex="${index === 0 ? '0' : '-1'}" data-tab-target="${idPrefix}-${index}">${tab}</button>`).join('')}</div>
${panes.map((pane, index) => `<section class="prep-material-pane ${paneClasses[index]}" id="${idPrefix}-${index}" role="tabpanel" aria-labelledby="${idPrefix}-tab-${index}" data-tab-pane${index === 0 ? '' : ' hidden'}>${pane}</section>`).join('\n')}`;
}

export function renderPrepIndex({ future = [], archive = [] } = {}) {
  const tabs = future.map((entry, index) => `<button class="tab" id="prep-tab-${index}" role="tab"
  aria-selected="${index === 0}" aria-controls="prep-pane-${index}"
  tabindex="${index === 0 ? '0' : '-1'}"
  data-tab-target="prep-pane-${index}" data-countdown-dt="${escapeHtml(entry.page.meta.datetime)}">
  <span class="tab-co">${escapeHtml(entry.page.meta.company)}</span>
  <span class="tab-when">${escapeHtml(formatPrepDatetime(entry.page.meta.datetime))}</span>
</button>`).join('\n');
  const countdown = future[0]
    ? `<div class="countdown" aria-live="off" data-tab-countdown data-dt="${escapeHtml(future[0].page.meta.datetime)}"></div>`
    : '<div class="countdown">No upcoming interviews</div>';
  const panes = future.map((entry, index) => `<div class="pane prep-pane" id="prep-pane-${index}" role="tabpanel"
  aria-labelledby="prep-tab-${index}" data-tab-pane data-prep-workspace data-prep-slug="${escapeHtml(entry.slug)}"${index === 0 ? '' : ' hidden'}>
  ${renderContentTabs(entry, `prep-content-${index}`)}
  <p class="foot"><a href="${hrefFor(entry.slug)}">Open this prep page directly</a></p>
  ${renderPrepNotes(entry.notes, entry.slug)}
</div>`).join('\n');
  const archived = archive.length
    ? `<ul class="facts">${archive.map(entry => `<li><span class="fk">${escapeHtml(formatPrepDatetime(entry.page.meta.datetime))}</span><span class="fv"><a href="${hrefFor(entry.slug)}">${escapeHtml(entry.page.meta.company)} — ${escapeHtml(entry.page.meta.role)}</a></span></li>`).join('')}</ul>`
    : '<p class="eyebrow">No archived interviews</p>';

  return `<div class="bar">
  <div class="bar-inner">
    <div class="tabs" role="tablist" aria-label="Interviews">${tabs}</div>
    ${countdown}
  </div>
</div>
${panes}
<section class="wrap" id="prep-archive">
  <h2>Archive</h2>
  ${archived}
  <p class="foot"><a href="/archive">Interview transcripts &amp; archive →</a></p>
</section>`;
}

export function renderPrepSingle(entry) {
  return `<main class="hub-main prep-page" data-prep-workspace data-prep-slug="${escapeHtml(entry.slug)}">
  ${renderContentTabs(entry, 'prep-content-single')}
  ${renderPrepNotes(entry.notes, entry.slug)}
</main>`;
}
