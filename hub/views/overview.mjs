import { escapeHtml, renderStatusChip } from './layout.mjs';
import { formatPrepDatetime } from '../gen-prep.mjs';

function percent(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return `${Math.round(numeric * 100)}%`;
}

function tile({ id, label, value, subtitle }) {
  return `<article class="tile" id="${id}">
  <span class="tile-label">${escapeHtml(label)}</span>
  <strong class="tile-value">${escapeHtml(value)}</strong>
  <span class="tile-label">${escapeHtml(subtitle)}</span>
</article>`;
}

function renderUpcoming(upcoming) {
  if (!upcoming.length) return '<p class="eyebrow">None scheduled</p>';
  return `<ul class="facts upcoming-list">${upcoming.map((item, index) => {
    if (!item.datetime || !item.slug) {
      return `<li>#${escapeHtml(item.num)} ${escapeHtml(item.company)} — ${escapeHtml(item.role)}</li>`;
    }
    const countdownClass = index === 0 ? 'countdown countdown-hero' : 'countdown';
    return `<li><span class="fk">${index === 0 ? 'Next' : 'Later'}</span><span class="fv"><a href="/prep/${encodeURIComponent(item.slug)}">${escapeHtml(item.company)} — ${escapeHtml(item.role)}</a><span class="${countdownClass}" data-dt="${escapeHtml(item.datetime)}"></span><span class="upcoming-when">${escapeHtml(formatPrepDatetime(item.datetime))}</span></span></li>`;
  }).join('')}</ul>`;
}

function renderFollowups(followupsDue) {
  if (followupsDue?.__error) return '<p class="eyebrow">unavailable</p>';
  if (!Array.isArray(followupsDue) || followupsDue.length === 0) {
    return '<p class="eyebrow">None due</p>';
  }

  return `<ul class="facts">${followupsDue.map(item => {
    const next = item.nextFollowupDate ? ` — due ${item.nextFollowupDate}` : '';
    return `<li>#${escapeHtml(item.num)} ${escapeHtml(item.company)} — ${escapeHtml(item.role)}${escapeHtml(next)}</li>`;
  }).join('')}</ul>`;
}

function renderRecent(recent) {
  if (!recent.length) return '<p class="eyebrow">No recent activity</p>';
  return `<ul class="facts recent-list">${recent.slice(0, 10).map(item =>
    `<li><span class="recent-meta">#${escapeHtml(item.num)} ${escapeHtml(item.date)}</span><span class="recent-states">${renderStatusChip(item.from)}<span aria-hidden="true">→</span>${renderStatusChip(item.to)}</span></li>`
  ).join('')}</ul>`;
}

export function renderOverview(data) {
  const funnel = data?.funnel ?? {};
  const ever = funnel.ever ?? {};
  const conversions = funnel.conversions ?? {};
  const quota = data?.quotaToday ?? funnel.quotaToday ?? { applied: 0, target: 10 };
  const rejected = ever.rejected ?? funnel.counts?.Rejected ?? 0;
  const rejectedRate = ever.applied ? rejected / ever.applied : 0;

  const tiles = [
    tile({ id: 'tile-applied', label: 'Applied', value: ever.applied ?? 0, subtitle: '100% · baseline' }),
    tile({ id: 'tile-responded', label: 'Responded', value: ever.responded ?? 0, subtitle: `${percent(conversions.appliedToResponded)} · from applied` }),
    tile({ id: 'tile-interview', label: 'Interview', value: ever.interview ?? 0, subtitle: `${percent(conversions.respondedToInterview)} · from responded` }),
    tile({ id: 'tile-offer', label: 'Offer', value: ever.offer ?? 0, subtitle: `${percent(conversions.interviewToOffer)} · from interview` }),
    tile({ id: 'tile-rejected', label: 'Rejected', value: rejected, subtitle: `${percent(rejectedRate)} · from applied` }),
    tile({ id: 'tile-quota', label: 'Today’s quota', value: `${quota.applied ?? 0}/${quota.target ?? 10}`, subtitle: 'applications today' }),
  ].join('');

  return `<main class="hub-main">
  <p class="eyebrow">Career Ops Hub</p>
  <h1>Overview</h1>
  <div class="grid">${tiles}</div>

  <section id="upcoming">
    <h2>Upcoming interviews</h2>
    ${renderUpcoming(data?.upcoming ?? [])}
  </section>

  <section id="followups-due">
    <h2>Follow-ups due</h2>
    ${renderFollowups(data?.followupsDue)}
  </section>

  <section id="recent">
    <h2>Recent activity</h2>
    ${renderRecent(data?.recent ?? [])}
  </section>

  <section id="inbox">
    <h2>Pipeline inbox</h2>
    <p><strong>${escapeHtml(data?.inbox ?? 0)}</strong> pending</p>
  </section>
</main>`;
}
