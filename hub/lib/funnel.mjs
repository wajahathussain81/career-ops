const STATES = [
  'Evaluated',
  'Applied',
  'Responded',
  'Interview',
  'Offer',
  'Hired',
  'Rejected',
  'Discarded',
  'SKIP',
];

const STAGE_RANKS = {
  applied: 1,
  responded: 2,
  interview: 3,
  offer: 4,
  hired: 5,
};

const STATUS_MAX_STAGE = {
  Evaluated: 0,
  Applied: 1,
  Responded: 2,
  Interview: 3,
  Offer: 4,
  Hired: 5,
  Rejected: 1,
  Discarded: 0,
  SKIP: 0,
};

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function computeFunnel({ apps, statusLog, today }) {
  const counts = Object.fromEntries(STATES.map(state => [state, 0]));
  const reachedStageByApp = new Map();

  for (const app of apps) {
    if (Object.hasOwn(counts, app.status)) counts[app.status] += 1;
    const num = String(app.num);
    const stage = STATUS_MAX_STAGE[app.status] ?? 0;
    reachedStageByApp.set(num, Math.max(reachedStageByApp.get(num) ?? 0, stage));
  }

  const appliedByDay = new Map();
  let appliedToday = 0;

  for (const row of statusLog) {
    const num = String(row.num);
    if (reachedStageByApp.has(num)) {
      const stage = STATUS_MAX_STAGE[row.to] ?? 0;
      reachedStageByApp.set(num, Math.max(reachedStageByApp.get(num), stage));
    }

    if (row.to !== 'Applied') continue;
    appliedByDay.set(row.date, (appliedByDay.get(row.date) ?? 0) + 1);
    if (row.date === today) appliedToday += 1;
  }

  const ever = Object.fromEntries(
    Object.entries(STAGE_RANKS).map(([key, rank]) => [
      key,
      [...reachedStageByApp.values()].filter(stage => stage >= rank).length,
    ]),
  );
  const conversions = {
    appliedToResponded: ratio(ever.responded, ever.applied),
    respondedToInterview: ratio(ever.interview, ever.responded),
    interviewToOffer: ratio(ever.offer, ever.interview),
    offerToHired: ratio(ever.hired, ever.offer),
  };

  return {
    counts,
    ever,
    conversions,
    responseRate: ratio(ever.responded, ever.applied),
    quotaToday: { applied: appliedToday, target: 10 },
    appliedByDay,
  };
}
