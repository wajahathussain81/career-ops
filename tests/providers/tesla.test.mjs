// tests/providers/tesla.test.mjs — offline Tesla state/parser/filter fixtures.
// No browser is launched and no network request is made by this suite.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { fail, pass, ROOT } from '../helpers.mjs';

console.log('\nStandalone scanner — Tesla careers (Playwright state + DOM fallback)');

try {
  const tesla = await import(pathToFileURL(join(ROOT, 'scan-tesla.mjs')).href);

  const stateFixture = {
    app: {
      careers: {
        searchResults: [
          {
            jobId: '101',
            title: '  Embedded Software Engineer  ',
            jobUrl: '/careers/search/job/embedded-software-engineer-101',
            locations: [{ city: 'Fremont', state: 'CA', country: 'United States' }],
            postingDate: '2026-08-01',
          },
          {
            posting_id: '202',
            job_title: 'C++ Firmware Engineer',
            detail_url: '/careers/search/job/c-firmware-engineer-202',
            location: { displayName: 'Palo Alto, CA, USA' },
            posted_at: 1_754_006_400,
          },
          {
            requisitionId: '303',
            postingTitle: 'Software Engineer, Vehicle UI',
            location: 'Toronto, Ontario, Canada',
          },
          {
            jobId: '101',
            title: 'Embedded Software Engineer',
            jobUrl: '/careers/search/job/embedded-software-engineer-101#duplicate',
            location: 'Fremont, CA, United States',
          },
          { title: 'Missing location', jobUrl: '/careers/search/job/missing-location-404' },
          { title: 'Foreign URL', jobUrl: 'https://example.com/jobs/505', location: 'Fremont' },
        ],
      },
    },
  };

  const jobs = tesla.parseTeslaState(stateFixture);
  if (jobs.length === 3) pass('parseTeslaState() finds nested records, drops malformed rows, and dedups URLs');
  else fail(`parseTeslaState() returned ${jobs.length} jobs, expected 3: ${JSON.stringify(jobs)}`);

  const fremont = jobs.find(job => job.url.includes('-101'));
  if (fremont?.title === 'Embedded Software Engineer' && fremont.location === 'Fremont, CA, United States') {
    pass('parseTeslaState() trims titles and formats object-array locations');
  } else {
    fail(`Fremont fixture normalized incorrectly: ${JSON.stringify(fremont)}`);
  }
  if (fremont?.postedAt === Date.parse('2026-08-01')) pass('parseTeslaState() normalizes posting dates to epoch milliseconds');
  else fail(`posting date normalized incorrectly: ${JSON.stringify(fremont?.postedAt)}`);

  const paloAlto = jobs.find(job => job.url.includes('-202'));
  if (paloAlto?.location === 'Palo Alto, CA, USA' && paloAlto.postedAt === 1_754_006_400_000) {
    pass('parseTeslaState() accepts snake_case fields and second-based timestamps');
  } else {
    fail(`Palo Alto fixture normalized incorrectly: ${JSON.stringify(paloAlto)}`);
  }

  const derived = jobs.find(job => job.title.includes('Vehicle UI'));
  if (derived?.url === 'https://www.tesla.com/careers/search/job/software-engineer-vehicle-ui-303') {
    pass('normalizeTeslaJob() derives Tesla job URLs from title + requisition id');
  } else {
    fail(`derived Tesla URL incorrect: ${JSON.stringify(derived?.url)}`);
  }

  const xssi = tesla.parseTeslaState(`)]}',\n${JSON.stringify({ jobs: [stateFixture.app.careers.searchResults[0]] })}`);
  if (xssi.length === 1 && xssi[0].title === 'Embedded Software Engineer') {
    pass('parseTeslaState() accepts JSON strings with an anti-XSSI prefix');
  } else {
    fail(`anti-XSSI JSON fixture parsed incorrectly: ${JSON.stringify(xssi)}`);
  }

  let malformedMessage = '';
  try {
    tesla.parseTeslaState('<html>blocked</html>');
  } catch (error) {
    malformedMessage = error.message;
  }
  if (/valid JSON/i.test(malformedMessage)) pass('parseTeslaState() reports non-JSON block pages clearly');
  else fail(`non-JSON fixture diagnostic was unclear: ${JSON.stringify(malformedMessage)}`);

  const mkJob = (id, title, location) => ({
    url: `https://www.tesla.com/careers/search/job/test-role-${id}`,
    company: 'Tesla',
    title,
    location,
    source: 'tesla',
  });
  const filterFixture = [
    mkJob('601', 'Embedded Software Engineer', 'Fremont, CA, United States'),
    mkJob('602', 'C++ Firmware Engineer', 'Palo Alto, CA, USA'),
    mkJob('603', 'Software Engineer', 'Austin, TX, United States'),
    mkJob('604', 'Technical Recruiter', 'Fremont, CA, United States'),
    mkJob('605', 'Software Engineer Intern', 'Palo Alto, CA, United States'),
    mkJob('606', 'Software Engineer', 'Toronto, Ontario, Canada'),
    mkJob('601', 'Embedded Software Engineer', 'Fremont, CA, United States'),
  ];
  const originalSeen = new Set([
    'https://www.tesla.com/careers/search/job/test-role-606?utm_source=history',
  ]);
  const filtered = tesla.filterTeslaJobs(filterFixture, {
    titleFilter: {
      positive: ['Software Engineer', 'Firmware'],
      negative: ['Intern'],
    },
    locationFilter: {
      always_allow: ['Fremont', 'Palo Alto'],
      allow: ['Canada', 'Toronto'],
      block: ['United States', 'USA'],
    },
    seenUrls: originalSeen,
  });

  if (filtered.matches.map(job => job.url.match(/\d+$/)?.[0]).join(',') === '601,602') {
    pass('filterTeslaJobs() lets Fremont/Palo Alto always_allow matches beat US blocks');
  } else {
    fail(`always_allow precedence failed: ${JSON.stringify(filtered.matches)}`);
  }
  if (filtered.locationSkipped.length === 1 && filtered.locationSkipped[0].url.endsWith('-603')) {
    pass('filterTeslaJobs() blocks other United States locations');
  } else {
    fail(`US location block failed: ${JSON.stringify(filtered.locationSkipped)}`);
  }
  if (filtered.titleSkipped.length === 2) pass('filterTeslaJobs() applies positive and negative title keywords');
  else fail(`title filtering returned ${filtered.titleSkipped.length} skips, expected 2`);
  if (filtered.duplicateSkipped.length === 2) pass('filterTeslaJobs() dedups history URLs and duplicates within the same scrape');
  else fail(`dedup returned ${filtered.duplicateSkipped.length} skips, expected 2`);
  if (originalSeen.size === 1) pass('filterTeslaJobs() keeps its fixture seen-URL Set immutable');
  else fail('filterTeslaJobs() mutated the caller-provided seen-URL Set');

  if (tesla.formatTeslaLocation(['Fremont, CA', { city: 'Palo Alto', state: 'CA' }, 'Fremont, CA']) === 'Fremont, CA | Palo Alto, CA') {
    pass('formatTeslaLocation() flattens and deduplicates mixed location arrays');
  } else {
    fail('formatTeslaLocation() did not normalize a mixed fixture array');
  }
} catch (error) {
  fail(`Tesla scanner tests crashed: ${error.stack || error.message}`);
}
