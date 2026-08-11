function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function statusTone(value) {
  const status = String(value ?? '').trim().toLowerCase();
  if (['interview', 'offer', 'hired'].includes(status)) return 'verified';
  if (status === 'rejected') return 'forbidden';
  if (status === 'responded') return 'reasoned';
  if (status === 'applied') return 'applied';
  return 'neutral';
}

function renderStatusChip(value) {
  return `<span class="status-chip status-${statusTone(value)}">${escapeHtml(value ?? '—')}</span>`;
}

const NAV_ITEMS = [
  ['overview', 'Overview', '/'],
  ['apps', 'Applications', '/apps'],
  ['contacts', 'Contacts', '/contacts'],
  ['prep', 'Prep', '/prep'],
  ['chat', 'Chat', '/chat'],
];

export function layout({ title = 'Career Ops', active = '', body = '', banner = '' } = {}) {
  const links = NAV_ITEMS.map(([key, label, href]) => {
    const current = active === href || active === key ? ' aria-current="page"' : '';
    return `<a href="${href}"${current}>${label}</a>`;
  }).join('');
  const bannerContent = Array.isArray(banner) && banner.length
    ? `<div class="flag forbid"><div class="flag-t">Sync conflicts detected</div><ul>${banner
      .map(file => `<li>${escapeHtml(file)}</li>`).join('')}</ul></div>`
    : banner;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Career Ops</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23161A18'/%3E%3Cpath d='M6 17h6l3-7 4 13 3-6h4' fill='none' stroke='%236FCFA3' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
  <link href="/assets/hub.css" rel="stylesheet">
  <script src="/assets/hub.js" defer></script>
</head>
<body>
  <nav class="nav" aria-label="Primary"><div class="nav-inner">${links}</div></nav>
  <div id="banner">${bannerContent}</div>
  ${body}
</body>
</html>`;
}

export { escapeHtml, renderStatusChip, statusTone };
