import { safeUrl } from '../lib/md.mjs';
import { escapeHtml } from './layout.mjs';

function links(contact) {
  const linkedin = safeUrl(escapeHtml(contact.linkedin));
  return [
    contact.phone ? `<a href="tel:${escapeHtml(contact.phone)}">Phone</a>` : '',
    contact.email ? `<a href="mailto:${escapeHtml(contact.email)}">Email</a>` : '',
    contact.linkedin ? (linkedin === null ? 'LinkedIn' : `<a href="${linkedin}">LinkedIn</a>`) : '',
  ].filter(Boolean).join(' · ') || '—';
}

function trackerLink(contact) {
  const tracker = Number(contact.tracker);
  return Number.isFinite(tracker)
    ? `<a href="/apps/${escapeHtml(tracker)}">#${escapeHtml(tracker)}</a>`
    : '—';
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
    return `<section><h2>${heading}</h2><div class="table-scroll"><table class="data">
      <thead><tr><th>Name</th><th>Type</th><th>Title</th><th>Links</th><th>Application</th><th>Notes</th></tr></thead>
      <tbody>${rows.map(contact => `<tr><td>${escapeHtml(contact.name)}</td><td>${escapeHtml(contact.type)}</td><td>${escapeHtml(contact.title)}</td><td>${links(contact)}</td><td>${trackerLink(contact)}</td><td>${escapeHtml(contact.notes)}</td></tr>`).join('')}</tbody>
    </table></div></section>`;
  }).join('');

  return `<main class="hub-main">
  <p class="eyebrow">Network</p>
  <h1>Contacts</h1>
  ${groups || '<p>No contacts recorded.</p>'}
</main>`;
}
