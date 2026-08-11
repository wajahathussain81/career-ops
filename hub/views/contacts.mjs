import { escapeHtml } from './layout.mjs';

function links(contact) {
  return [
    contact.phone ? `<a href="tel:${escapeHtml(contact.phone)}">Phone</a>` : '',
    contact.email ? `<a href="mailto:${escapeHtml(contact.email)}">Email</a>` : '',
    contact.linkedin ? `<a href="${escapeHtml(contact.linkedin)}">LinkedIn</a>` : '',
  ].filter(Boolean).join(' · ') || '—';
}

export function renderContacts(contacts = []) {
  const grouped = new Map();
  for (const contact of contacts) {
    const company = contact.company || 'Unknown company';
    if (!grouped.has(company)) grouped.set(company, []);
    grouped.get(company).push(contact);
  }

  const groups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([company, rows]) => {
    const tracker = rows.find(row => row.tracker)?.tracker;
    const heading = tracker
      ? `<a href="/apps/${escapeHtml(tracker)}">${escapeHtml(company)}</a>`
      : escapeHtml(company);
    return `<section><h2>${heading}</h2><table class="data">
      <thead><tr><th>Name</th><th>Type</th><th>Title</th><th>Links</th><th>Notes</th></tr></thead>
      <tbody>${rows.map(contact => `<tr><td>${escapeHtml(contact.name)}</td><td>${escapeHtml(contact.type)}</td><td>${escapeHtml(contact.title)}</td><td>${links(contact)}</td><td>${escapeHtml(contact.notes)}</td></tr>`).join('')}</tbody>
    </table></section>`;
  }).join('');

  return `<main class="hub-main">
  <p class="eyebrow">Network</p>
  <h1>Contacts</h1>
  ${groups || '<p>No contacts recorded.</p>'}
</main>`;
}
