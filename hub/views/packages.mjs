import { escapeHtml, renderStatusChip } from './layout.mjs';

function renderPackageLinks(row) {
  const links = [];
  if (row.hasResume) {
    links.push(`<a href="/files/resume/${escapeHtml(row.num)}">Resume</a>`);
  }
  if (row.hasCover) {
    links.push(`<a href="/files/cover/${escapeHtml(row.num)}">Cover letter</a>`);
  }
  if (row.reportNum) {
    links.push(`<a href="/apps/${escapeHtml(row.num)}">Report #${escapeHtml(row.reportNum)}</a>`);
  }
  return links.length ? links.join(' · ') : '—';
}

export function renderPackages(rows = []) {
  const content = rows.length
    ? `<div class="table-scroll"><table class="data">
    <thead><tr><th>Company</th><th>Role</th><th>Status</th><th>Score</th><th>Date</th><th>Package</th></tr></thead>
    <tbody>${rows.map(row => `<tr>
      <td>${escapeHtml(row.company)}</td>
      <td>${escapeHtml(row.role ?? '—')}</td>
      <td>${renderStatusChip(row.status)}</td>
      <td>${escapeHtml(row.score ?? '—')}</td>
      <td>${escapeHtml(row.date ?? '—')}</td>
      <td>${renderPackageLinks(row)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`
    : '<p>No application packages have been generated yet.</p>';

  return `<main class="hub-main">
  <p class="eyebrow">Generated artifacts</p>
  <h1>Packages</h1>
  ${content}
</main>`;
}
