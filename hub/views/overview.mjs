import { escapeHtml, renderStatusChip } from './layout.mjs';
import { formatPrepDatetime } from '../gen-prep.mjs';

function percent(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return `${Math.round(numeric * 100)}%`;
}

function tile({ id, label, value, tone = '' }) {
  const valueTone = tone || (Number(value) > 0 ? 'has-value' : 'is-zero');
  return `<article class="tile ${valueTone}" id="${id}">
  <span class="tile-label">${escapeHtml(label)}</span>
  <strong class="tile-value">${escapeHtml(value)}</strong>
</article>`;
}

function conversion(value, label) {
  return `<span class="conversion" aria-label="${escapeHtml(label)} conversion"><span aria-hidden="true">→</span> ${escapeHtml(percent(value))}</span>`;
}

function quotaTile(applied) {
  const value = Math.max(0, Number(applied) || 0);
  const target = 10;
  const filled = Math.min(target, Math.round(value));
  const segments = Array.from({ length: target }, (_, index) =>
    `<span class="quota-segment${index < filled ? ' is-filled' : ''}" aria-hidden="true"></span>`
  ).join('');
  return `<article class="quota-instrument" id="tile-quota">
    <span class="tile-label">Today’s quota</span>
    <span class="quota-meter" role="meter" aria-label="Applications today" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${escapeHtml(Math.min(value, target))}">${segments}</span>
    <strong class="quota-value">${escapeHtml(value)}/${target}</strong>
  </article>`;
}

function renderUpcoming(upcoming) {
  if (!upcoming.length) return '<p class="eyebrow">None scheduled</p>';
  const [next, ...later] = upcoming;
  const nextInstrument = next.datetime && next.slug
    ? `<article class="interview-instrument">
      <span class="instrument-kicker">Next interview</span>
      <h3 class="interview-heading"><a href="/prep/${encodeURIComponent(next.slug)}"><span class="interview-company">${escapeHtml(next.company)}</span><span class="interview-role">${escapeHtml(next.role)}</span></a></h3>
      <span class="countdown countdown-hero" data-dt="${escapeHtml(next.datetime)}"></span>
      <span class="upcoming-when">${escapeHtml(formatPrepDatetime(next.datetime))}</span>
    </article>`
    : `<p>#${escapeHtml(next.num)} ${escapeHtml(next.company)} — ${escapeHtml(next.role)}</p>`;
  const laterList = later.length ? `<div class="later-interviews"><span class="instrument-kicker">Subsequent</span><ul class="facts upcoming-list">${later.map(item => {
    if (!item.datetime || !item.slug) {
      return `<li>#${escapeHtml(item.num)} ${escapeHtml(item.company)} — ${escapeHtml(item.role)}</li>`;
    }
    return `<li><span class="fv"><a href="/prep/${encodeURIComponent(item.slug)}">${escapeHtml(item.company)} — ${escapeHtml(item.role)}</a><span class="countdown" data-dt="${escapeHtml(item.datetime)}"></span><span class="upcoming-when">${escapeHtml(formatPrepDatetime(item.datetime))}</span></span></li>`;
  }).join('')}</ul></div>` : '';
  return `${nextInstrument}${laterList}`;
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

  const tiles = `<div class="funnel-stages">
    ${tile({ id: 'tile-applied', label: 'Applied', value: ever.applied ?? 0 })}
    ${conversion(conversions.appliedToResponded, 'Applied to responded')}
    ${tile({ id: 'tile-responded', label: 'Responded', value: ever.responded ?? 0 })}
    ${conversion(conversions.respondedToInterview, 'Responded to interview')}
    ${tile({ id: 'tile-interview', label: 'Interview', value: ever.interview ?? 0 })}
    ${conversion(conversions.interviewToOffer, 'Interview to offer')}
    ${tile({ id: 'tile-offer', label: 'Offer', value: ever.offer ?? 0 })}
    ${conversion(rejectedRate, 'Applied to rejected')}
    ${tile({ id: 'tile-rejected', label: 'Rejected', value: rejected, tone: 'forbidden-value' })}
  </div>${quotaTile(quota.applied)}`;

  return `<main class="hub-main">
  <p class="eyebrow">Career Ops Hub</p>
  <h1>Overview</h1>
  <section class="grid instrument-strip" aria-label="Application funnel">${tiles}</section>

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
