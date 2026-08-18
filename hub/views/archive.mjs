import { formatPrepDatetime } from '../gen-prep.mjs';
import { sessionMatchesPrepSlug } from '../lib/data.mjs';
import { escapeHtml } from './layout.mjs';

const ROUND_LABELS = {
  screen: 'Screen',
  'hiring-manager': 'Hiring manager',
  technical: 'Technical',
  'system-design': 'System design',
  behavioral: 'Behavioral',
  onsite: 'Onsite',
  final: 'Final',
};

function hrefFor(slug) {
  return `/archive/${encodeURIComponent(slug)}`;
}

function prepHrefFor(slug) {
  return `/prep/${encodeURIComponent(slug)}`;
}

function roundTone(round) {
  const key = String(round ?? '').trim().toLowerCase();
  if (['technical', 'system-design', 'onsite', 'final'].includes(key)) return 'verified';
  if (['hiring-manager', 'behavioral'].includes(key)) return 'reasoned';
  return 'neutral';
}

function renderRoundChip(round) {
  const key = String(round ?? '').trim().toLowerCase();
  const label = ROUND_LABELS[key] ?? (round || '—');
  return `<span class="status-chip round-chip status-${roundTone(round)}">${escapeHtml(label)}</span>`;
}

function formatSessionDate(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value ?? '') || '—';
  const [, year, month, day] = match;
  const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const weekday = new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(calendarDate);
  const monthName = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(calendarDate);
  return `${weekday} ${monthName} ${Number(day)}, ${year}`;
}

function renderEngagement({ company, role, sessions, prepEntry }) {
  const rounds = sessions.map(session => `<li class="archive-round">
  <a href="${hrefFor(session.slug)}">
    ${renderRoundChip(session.round)}
    <span class="archive-round-date">${escapeHtml(formatSessionDate(session.date))}</span>
    <span class="archive-round-interviewer">${escapeHtml(session.interviewerRole || '—')}</span>
    <span class="archive-round-turns">${session.turns.length} question${session.turns.length === 1 ? '' : 's'}</span>
  </a>
</li>`).join('\n');
  const prepLink = prepEntry
    ? `<p class="foot"><a href="${prepHrefFor(prepEntry.slug)}">Prep page →</a></p>`
    : '';

  return `<article class="archive-engagement">
  <header class="archive-engagement-head">
    <h2>${escapeHtml(company) || '—'}</h2>
    <p class="archive-engagement-role">${escapeHtml(role)}</p>
  </header>
  <ul class="archive-round-list">${rounds}</ul>
  ${prepLink}
</article>`;
}

export function renderArchiveIndex({ sessions = [], pastPrep = [] } = {}) {
  const groups = new Map();
  for (const session of sessions) {
  const key = `${session.company}\0${session.role}`;
    if (!groups.has(key)) groups.set(key, { company: session.company, role: session.role, sessions: [] });
    groups.get(key).sessions.push(session);
  }

  const engagements = [...groups.values()].map(group => {
    const chronological = [...group.sessions].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.slug.localeCompare(b.slug);
    });
    const mostRecentDate = chronological.reduce((max, s) => (s.date > max ? s.date : max), chronological[0]?.date ?? '');
    const prepEntry = pastPrep.find(entry => sessionMatchesPrepSlug(group.company, entry.slug)) ?? null;
    return { company: group.company, role: group.role, sessions: chronological, mostRecentDate, prepEntry };
  }).sort((a, b) => (a.mostRecentDate < b.mostRecentDate ? 1 : a.mostRecentDate > b.mostRecentDate ? -1 : 0));

  const withoutTranscripts = pastPrep
    .filter(entry => !entry.hasTranscript)
    .sort((a, b) => String(b.datetime ?? '').localeCompare(String(a.datetime ?? '')));

  const engagementsHtml = engagements.length
    ? engagements.map(renderEngagement).join('\n')
    : '<p class="eyebrow">No archived interviews yet</p>';

  const withoutTranscriptsHtml = withoutTranscripts.length
    ? `<ul class="facts">${withoutTranscripts.map(entry => `<li><span class="fk">${escapeHtml(formatPrepDatetime(entry.datetime))}</span><span class="fv"><a href="${prepHrefFor(entry.slug)}">${escapeHtml(entry.company)} — ${escapeHtml(entry.role)}</a></span></li>`).join('')}</ul>`
    : '';

  return `<main class="hub-main archive-page">
  <section class="wrap archive-index">
    <h1>Interview archive</h1>
    ${engagementsHtml}
  </section>
  ${withoutTranscriptsHtml ? `<section class="wrap archive-no-transcript">
    <h2>Prep pages without transcripts</h2>
    ${withoutTranscriptsHtml}
  </section>` : ''}
</main>`;
}

function renderTurn(turn) {
  const competencyChips = turn.competencies?.length
    ? `<div class="qa-competencies">${turn.competencies.map(tag => `<span class="competency-chip">${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';
  const answerParagraphs = String(turn.a ?? '')
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => `<p>${escapeHtml(part)}</p>`)
    .join('') || '<p class="eyebrow">No answer recorded</p>';

  return `<div class="qa-exchange">
  <div class="qa-q">
    <p class="eyebrow">Interviewer</p>
    <p>${escapeHtml(turn.q)}</p>
    ${competencyChips}
  </div>
  <div class="qa-a">
    <p class="eyebrow">You</p>
    ${answerParagraphs}
  </div>
</div>`;
}

export function renderArchiveSession(session) {
  const turnsHtml = (session.turns ?? []).map(renderTurn).join('\n');
  const questionsHtml = session.candidateQuestions?.length
    ? `<section class="archive-candidate-questions">
    <h2>Questions you asked</h2>
    <ul class="archive-question-list">${session.candidateQuestions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
  </section>`
    : '';

  return `<main class="hub-main archive-session-page">
  <p class="eyebrow"><a href="/archive">← Archive</a></p>
  <header class="archive-session-head">
    <h1>${escapeHtml(session.company) || '—'}</h1>
    <p class="archive-session-role">${escapeHtml(session.role)}</p>
    <ul class="facts">
      <li><span class="fk">Round</span><span class="fv">${renderRoundChip(session.round)}</span></li>
      <li><span class="fk">Date</span><span class="fv">${escapeHtml(formatSessionDate(session.date))}</span></li>
      <li><span class="fk">Interviewer</span><span class="fv">${escapeHtml(session.interviewerRole || '—')}</span></li>
    </ul>
  </header>
  <section class="archive-exchanges">
    ${turnsHtml}
  </section>
  ${questionsHtml}
</main>`;
}
