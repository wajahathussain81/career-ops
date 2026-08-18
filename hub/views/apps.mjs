import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { escapeHtml, renderStatusChip } from './layout.mjs';

const APP_COLUMNS = [
  ['num', '#'],
  ['date', 'Date'],
  ['company', 'Company'],
  ['role', 'Role'],
  ['score', 'Score'],
  ['status', 'Status'],
];

export function loadStateLabels(root) {
  const file = join(root, 'templates', 'states.yml');
  if (!existsSync(file)) return [];
  try {
    const parsed = yaml.load(readFileSync(file, 'utf8'))?.states;
    if (Array.isArray(parsed)) {
      return parsed.map(state => typeof state === 'string' ? state : state?.label || state?.id)
        .filter(Boolean);
    }
    return parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
  } catch {
    return [];
  }
}

export function renderAppRows(rows) {
  return rows.map(row => `<tr>
    <td><a href="/apps/${escapeHtml(row.num)}">#${escapeHtml(row.num)}</a></td>
    <td>${escapeHtml(row.date)}</td>
    <td><a href="/apps/${escapeHtml(row.num)}">${escapeHtml(row.company)}</a></td>
    <td>${escapeHtml(row.role)}</td>
    <td>${escapeHtml(row.score ?? '—')}</td>
    <td>${renderStatusChip(row.status)}</td>
  </tr>`).join('');
}

export function renderApps({ rows = [], statuses = [], filters = {} } = {}) {
  const statusOptions = ['<option value="">All</option>', ...statuses.map(status =>
    `<option value="${escapeHtml(status)}"${filters.status === status ? ' selected' : ''}>${escapeHtml(status)}</option>`
  )].join('');
  const scores = ['3.0', '3.5', '4.0', '4.5'];
  const scoreOptions = ['<option value="">Any</option>', ...scores.map(score =>
    `<option value="${score}"${String(filters.minScore ?? '') === score ? ' selected' : ''}>${score}</option>`
  )].join('');
  const activeSort = APP_COLUMNS.some(([key]) => key === filters.sort) ? filters.sort : '';
  const activeDir = filters.dir === 'desc' ? 'desc' : 'asc';
  const headers = APP_COLUMNS.map(([key, label]) => {
    const active = key === activeSort;
    const ariaSort = active ? ` aria-sort="${activeDir === 'desc' ? 'descending' : 'ascending'}"` : '';
    const caret = active ? (activeDir === 'desc' ? '▼' : '▲') : '';
    return `<th${ariaSort}><button type="button" class="th-sort" data-sort="${escapeHtml(key)}">${escapeHtml(label)} <span class="sort-caret" aria-hidden="true">${caret}</span></button></th>`;
  }).join('');

  return `<main class="hub-main">
  <p class="eyebrow">Tracker</p>
  <h1>Applications</h1>
  <div class="apps-filter-row">
    <form id="apps-form">
      <label>Status <select name="status">${statusOptions}</select></label>
      <label class="filter-search">Search <input name="q" type="search" value="${escapeHtml(filters.q ?? '')}" placeholder="Company, role, or notes"></label>
      <label>Minimum score <select name="minScore">${scoreOptions}</select></label>
    </form>
    <p class="apps-results"><span id="apps-total">${rows.length}</span> results</p>
  </div>
  <div class="table-scroll"><table class="data apps-table">
    <thead><tr>${headers}</tr></thead>
    <tbody id="apps-tbody">${renderAppRows(rows)}</tbody>
  </table></div>
</main>`;
}
