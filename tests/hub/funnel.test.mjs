import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
console.log('\nHub — funnel');
const FIX = join(ROOT, 'tests/hub/fixtures');
const d = await import(pathToFileURL(join(ROOT, 'hub/lib/data.mjs')).href);
const { computeFunnel } = await import(pathToFileURL(join(ROOT, 'hub/lib/funnel.mjs')).href);
const f = computeFunnel({ apps: d.loadApplications(FIX), statusLog: d.loadStatusLog(FIX), today: '2026-08-02' });
if (f.ever.applied === 3) pass('ever.applied counts log+current (1,2,3)'); else fail(`ever.applied=${f.ever.applied}`);
if (f.ever.responded === 1 && f.ever.interview === 1) pass('ever responded/interview'); else fail(JSON.stringify(f.ever));
if (Math.abs(f.responseRate - 1/3) < 1e-9) pass('response rate 1/3'); else fail(`rr=${f.responseRate}`);
if (Math.abs(f.conversions.respondedToInterview - 1) < 1e-9) pass('responded→interview 100%'); else fail(`${f.conversions.respondedToInterview}`);
if (f.conversions.offerToHired === 0) pass('zero denominator → 0, not NaN'); else fail(`${f.conversions.offerToHired}`);
if (f.quotaToday.applied === 1 && f.quotaToday.target === 10) pass('quota today from status log'); else fail(JSON.stringify(f.quotaToday));
if (f.counts.Interview === 1 && f.counts.Evaluated === 1) pass('current counts'); else fail(JSON.stringify(f.counts));

const inlineApps = [
  { num: 101, status: 'Responded' },
  { num: 102, status: 'Rejected' },
  { num: 103, status: 'Hired' },
];
const preLogResponded = computeFunnel({ apps: [inlineApps[0]], statusLog: [], today: '2026-08-02' });
if (preLogResponded.ever.applied === 1 && preLogResponded.ever.responded === 1) pass('current Responded implies ever applied+responded without logs');
else fail(`pre-log Responded=${JSON.stringify(preLogResponded.ever)}`);
const preLogRejected = computeFunnel({ apps: [inlineApps[1]], statusLog: [], today: '2026-08-02' });
if (preLogRejected.ever.applied === 1 && preLogRejected.ever.responded === 0) pass('current Rejected implies ever applied only without logs');
else fail(`pre-log Rejected=${JSON.stringify(preLogRejected.ever)}`);
const preLogHired = computeFunnel({ apps: [inlineApps[2]], statusLog: [], today: '2026-08-02' });
if (Object.values(preLogHired.ever).every(value => value === 1)) pass('current Hired implies all ever stages without logs');
else fail(`pre-log Hired=${JSON.stringify(preLogHired.ever)}`);

const combined = computeFunnel({
  apps: [...d.loadApplications(FIX), ...inlineApps],
  statusLog: d.loadStatusLog(FIX),
  today: '2026-08-02',
});
const { applied, responded, interview, offer, hired } = combined.ever;
if (applied >= responded && responded >= interview && interview >= offer && offer >= hired) pass('ever stages are monotonic');
else fail(`non-monotonic ever=${JSON.stringify(combined.ever)}`);

const deduped = computeFunnel({
  apps: [
    { num: 201, date: '2026-08-02', status: 'Responded' },
    { num: 202, date: '2026-08-02', status: 'Responded' },
  ],
  statusLog: [
    { num: 201, date: '2026-08-02', to: 'Applied' },
    { num: 201, date: '2026-08-02', to: 'Applied' },
    { num: 202, date: '2026-08-02', to: 'Applied' },
  ],
  today: '2026-08-02',
});
if (deduped.quotaToday.applied === 2 && deduped.appliedByDay.get('2026-08-02') === 2) {
  pass('quota deduplicates repeated Applied transitions per application and day');
} else fail(`deduped quota=${JSON.stringify(deduped.quotaToday)}`);

const batchFallback = computeFunnel({
  apps: [
    { num: 301, date: '2026-08-02', status: 'Applied' },
    { num: 302, date: '2026-08-02', status: 'Applied' },
  ],
  statusLog: [
    { num: 302, date: '2026-08-02', to: 'Applied' },
  ],
  today: '2026-08-02',
});
if (batchFallback.quotaToday.applied === 2) {
  pass('quota includes Applied tracker rows missing from the ledger without double-counting logged rows');
} else fail(`batch fallback quota=${JSON.stringify(batchFallback.quotaToday)}`);

const previousTz = process.env.CAREER_OPS_TZ;
try {
  process.env.CAREER_OPS_TZ = 'America/Edmonton';
  const expectedDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.CAREER_OPS_TZ,
  }).format(new Date());
  const timezoneQuota = computeFunnel({
    apps: [{ num: 401, date: expectedDay, status: 'Applied' }],
    statusLog: [],
    today: '1900-01-01',
  });
  if (timezoneQuota.quotaToday.applied === 1) {
    pass('quota day follows CAREER_OPS_TZ when opted in');
  } else fail(`timezone quota=${JSON.stringify(timezoneQuota.quotaToday)} expectedDay=${expectedDay}`);
} finally {
  if (previousTz === undefined) delete process.env.CAREER_OPS_TZ;
  else process.env.CAREER_OPS_TZ = previousTz;
}
