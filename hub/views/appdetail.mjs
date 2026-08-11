import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { mdToHtml } from '../lib/md.mjs';
import { escapeHtml, renderStatusChip } from './layout.mjs';

function fact(label, value) {
  return `<li><span class="fk">${escapeHtml(label)}</span><span class="fv">${escapeHtml(value ?? '—')}</span></li>`;
}

function renderNotesFact(value) {
  const notes = String(value ?? '').split('; ').filter(note => note !== '');
  if (!notes.length) return fact('Notes', '—');
  const list = items => `<ul>${items.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`;
  const disclosure = notes.length > 2
    ? `<details><summary>all ${notes.length} notes</summary>${list(notes)}</details>`
    : '';
  return `<li class="notes-fact"><span class="fk">Notes</span><span class="fv notes-wall">${list(notes.slice(0, 2))}${disclosure}</span></li>`;
}

function readMarkdown(file, fallback) {
  return file && existsSync(file) ? mdToHtml(readFileSync(file, 'utf8')) : `<p>${fallback}</p>`;
}

function renderTimeline(rows) {
  if (!rows.length) return '<p>No status history recorded.</p>';
  return `<ol>${rows.map(row => `<li><strong>${escapeHtml(row.date)}</strong> — ${escapeHtml(row.from)} → ${escapeHtml(row.to)}</li>`).join('')}</ol>`;
}

function contactLinks(contact) {
  return [
    contact.phone ? `<a href="tel:${escapeHtml(contact.phone)}">Phone</a>` : '',
    contact.email ? `<a href="mailto:${escapeHtml(contact.email)}">Email</a>` : '',
    contact.linkedin ? `<a href="${escapeHtml(contact.linkedin)}">LinkedIn</a>` : '',
  ].filter(Boolean).join(' · ') || '—';
}

function renderPeople(contacts, followUps) {
  const contactRows = contacts.map(contact => `<tr><td>${escapeHtml(contact.name)}</td><td>${escapeHtml(contact.type)}</td><td>${escapeHtml(contact.title)}</td><td>${contactLinks(contact)}</td></tr>`).join('');
  const followUpRows = followUps.map(row => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.channel)}</td><td>${escapeHtml(row.contact)}</td><td>${escapeHtml(row.notes)}</td></tr>`).join('');
  return `<h2>Contacts</h2>
  ${contacts.length ? `<table class="data"><thead><tr><th>Name</th><th>Type</th><th>Title</th><th>Links</th></tr></thead><tbody>${contactRows}</tbody></table>` : '<p>No contacts recorded.</p>'}
  <h2>Follow-ups</h2>
  ${followUps.length ? `<table class="data"><thead><tr><th>Date</th><th>Channel</th><th>Contact</th><th>Notes</th></tr></thead><tbody>${followUpRows}</tbody></table>` : '<p>No follow-ups recorded.</p>'}`;
}

function renderResume(resume, num) {
  if (!resume) return '<p>No PDF recorded</p>';
  if (!resume.exists) {
    return `<p>${escapeHtml(basename(resume.path))} — not synced</p>`;
  }
  return `<embed src="/files/resume/${escapeHtml(num)}" type="application/pdf" width="100%" height="800">`;
}

function renderStatusControl(app, statuses) {
  const labels = statuses.length ? statuses : [app.status];
  const options = labels.map(status =>
    `<option value="${escapeHtml(status)}"${status === app.status ? ' selected' : ''}>${escapeHtml(status)}</option>`
  ).join('');
  return `<li data-status-control data-num="${escapeHtml(app.num)}">
    <span class="fk">Status</span>
    <span class="fv status-actions">${renderStatusChip(app.status)}<select name="state" aria-label="Application status">${options}</select><button type="button" data-status-apply>Apply</button></span>
    <div class="flag forbid" data-status-error role="alert" hidden></div>
  </li>`;
}

export function renderApplicationDetail(detail) {
  const { app, timeline, resume, contacts, followUps, reportFile, jdFile, statuses = [] } = detail;
  const tabs = ['Report', 'JD', 'Resume', 'People'];
  const panes = [
    readMarkdown(reportFile, 'No report on file'),
    readMarkdown(jdFile, 'No JD on file'),
    renderResume(resume, app.num),
    renderPeople(contacts, followUps),
  ];

  return `<main class="hub-main">
  <p class="eyebrow">Application #${escapeHtml(app.num)}</p>
  <h1>${escapeHtml(app.company)} — ${escapeHtml(app.role)}</h1>
  <ul class="facts">
    ${fact('Company', app.company)}${fact('Role', app.role)}${fact('Score', app.score)}
    ${renderStatusControl(app, statuses)}${fact('Via', app.via)}${fact('Date', app.date)}${renderNotesFact(app.notes)}
  </ul>
  <section><h2>Status timeline</h2>${renderTimeline(timeline)}</section>
  <div class="tabs" role="tablist">${tabs.map((tab, index) => `<button class="tab" type="button" role="tab" aria-selected="${index === 0}" aria-controls="app-pane-${index}" data-tab-target="app-pane-${index}">${tab}</button>`).join('')}</div>
  ${panes.map((pane, index) => `<section id="app-pane-${index}" role="tabpanel" data-tab-pane${index === 0 ? '' : ' hidden'}>${pane}</section>`).join('')}
</main>`;
}
