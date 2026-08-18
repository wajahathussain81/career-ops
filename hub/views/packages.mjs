import { escapeHtml } from './layout.mjs';

function renderReport(row) {
  return row.reportNum
    ? `<a href="/apps/${escapeHtml(row.num)}">Report #${escapeHtml(row.reportNum)}</a>`
    : '—';
}

export function renderPackages(rows = []) {
  const content = rows.length
    ? `<div class="table-scroll"><table class="data">
    <thead><tr><th>#</th><th>Company</th><th>Role</th><th>Score</th><th>Resume</th><th>Cover Letter</th><th>Apply</th><th>Report</th><th>Action</th></tr></thead>
    <tbody>${rows.map(row => `<tr>
      <td>${escapeHtml(row.num)}</td>
      <td>${escapeHtml(row.company)}</td>
      <td>${escapeHtml(row.role ?? '—')}</td>
      <td>${escapeHtml(row.score ?? '—')}</td>
      <td>${row.hasResume ? `<a href="/files/resume/${escapeHtml(row.num)}" target="_blank" rel="noopener noreferrer">Resume</a>` : '❌'}</td>
      <td>${row.hasCover ? `<a href="/files/cover/${escapeHtml(row.num)}" target="_blank" rel="noopener noreferrer">Cover letter</a>` : '❌'}</td>
      <td>${row.applyUrl
        ? `<a href="${escapeHtml(row.applyUrl)}" target="_blank" rel="noopener noreferrer">Apply</a>`
        : '❌'}</td>
      <td>${renderReport(row)}</td>
      <td><button class="pkg-apply" data-num="${escapeHtml(row.num)}" type="button">Mark applied</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`
    : '<p>No pending packages — stage one under output/upload/</p>';

  return `<main class="hub-main">
  <p class="eyebrow">Pending apply</p>
  <h1>Packages</h1>
  ${content}
</main>`;
}
