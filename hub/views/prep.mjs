import { formatPrepDatetime, renderPrepPage } from '../gen-prep.mjs';
import { escapeHtml } from './layout.mjs';

function hrefFor(slug) {
  return `/prep/${encodeURIComponent(slug)}`;
}

export function renderPrepIndex({ future = [], archive = [] } = {}) {
  const tabs = future.map((entry, index) => `<button class="tab" id="prep-tab-${index}" role="tab"
  aria-selected="${index === 0}" aria-controls="prep-pane-${index}"
  data-tab-target="prep-pane-${index}" data-countdown-dt="${escapeHtml(entry.page.meta.datetime)}">
  <span class="tab-co">${escapeHtml(entry.page.meta.company)}</span>
  <span class="tab-when">${escapeHtml(formatPrepDatetime(entry.page.meta.datetime))}</span>
</button>`).join('\n');
  const countdown = future[0]
    ? `<div class="countdown" aria-live="off" data-tab-countdown data-dt="${escapeHtml(future[0].page.meta.datetime)}"></div>`
    : '<div class="countdown">No upcoming interviews</div>';
  const panes = future.map((entry, index) => `<div class="wrap pane" id="prep-pane-${index}" role="tabpanel"
  aria-labelledby="prep-tab-${index}" data-tab-pane${index === 0 ? '' : ' hidden'}>
  ${renderPrepPage(entry.page)}
  <p class="foot"><a href="${hrefFor(entry.slug)}">Open this prep page directly</a></p>
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
</section>`;
}

export function renderPrepSingle(page) {
  return `<main class="wrap">${renderPrepPage(page)}</main>`;
}
