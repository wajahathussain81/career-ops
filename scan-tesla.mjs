#!/usr/bin/env node

/**
 * scan-tesla.mjs — Tesla careers scanner via Playwright
 *
 * Tesla's careers state endpoint is protected at the edge, so this scanner
 * opens the public careers search in Chromium and fetches the JSON state from
 * inside that browser page. If the state response cannot be used, it falls
 * back to reading the rendered search-result cards defensively.
 *
 * Known limitation (as of 2026-08-09):
 * - Tesla hard-blocks automated access. Verified failures: plain HTTP 403;
 *   headless Playwright 403 on both the JSON state endpoint and the DOM
 *   fallback; Firecrawl stealth proxy HTTP 500 "Not Allowed"; and an Akamai
 *   Bot Manager challenge when driven through a browser extension.
 * - The protection is Akamai Bot Manager. Automated discovery is considered
 *   a dead end; do not sink further effort into defeating it.
 * - The working route is a human-driven browser session: a person navigates
 *   and scrolls tesla.com/careers/search, and the rendered listings are then
 *   read. Job detail pages remain blocked even that way, so JD bodies must be
 *   supplied manually.
 * - This scanner is retained because it fails cleanly (clear diagnostic,
 *   exit 1, no partial writes) and documents the attempt.
 *
 * Usage:
 *   node scan-tesla.mjs                  # JSON to stdout
 *   node scan-tesla.mjs --summary        # human-readable table
 *   node scan-tesla.mjs --dry-run        # fetch/filter only; write nothing
 *   node scan-tesla.mjs --dry-run --summary
 *   node scan-tesla.mjs --help
 */

import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import yaml from 'js-yaml';

import {
  appendScanRunSummary,
  appendToPipeline,
  appendToScanHistory,
  buildLocationFilter,
  buildTitleFilter,
  loadSeenUrls,
  normalizeUrlForDedup,
} from './scan.mjs';

const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || 'portals.yml';
const TESLA_SEARCH_URL = 'https://www.tesla.com/careers/search/';
const TESLA_STATE_URL = 'https://www.tesla.com/cua-api/apps/careers/state';
const TESLA_JOB_ANCHORS = [
  'a[href*="/careers/search/job/"]',
  'a[href*="/careers/search/"][href*="jobId="]',
  'a[href*="/careers/search/"][href*="id="]',
].join(', ');

export const USAGE = `Usage:
  node scan-tesla.mjs                  # JSON to stdout
  node scan-tesla.mjs --summary        # human-readable table
  node scan-tesla.mjs --dry-run        # fetch/filter only; write nothing
  node scan-tesla.mjs --dry-run --summary
  node scan-tesla.mjs --help`;

const TITLE_KEYS = ['title', 'jobTitle', 'job_title', 'postingTitle', 'posting_title', 'positionTitle', 'position_title', 'name'];
const URL_KEYS = [
  'jobUrl', 'jobURL', 'job_url', 'jobDetailUrl', 'jobDetailURL', 'job_detail_url',
  'detailUrl', 'detailURL', 'detail_url', 'postingUrl', 'postingURL', 'posting_url',
  'canonicalUrl', 'canonical_url', 'jobPath', 'job_path', 'href', 'link', 'url',
];
const ID_KEYS = [
  'jobId', 'jobID', 'job_id', 'jobNumber', 'job_number', 'postingId', 'postingID',
  'posting_id', 'requisitionId', 'requisitionID', 'requisition_id',
  'requisitionNumber', 'requisition_number', 'reqId', 'reqID', 'req_id', 'id',
];
const DATE_KEYS = [
  'postedAt', 'posted_at', 'postingDate', 'posting_date', 'publishDate',
  'publish_date', 'publishedAt', 'published_at', 'createdAt', 'created_at', 'date',
];

class TeslaScanError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TeslaScanError';
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function firstString(object, keys) {
  for (const key of keys) {
    const value = nonEmptyString(object?.[key]);
    if (value) return value;
  }
  return '';
}

function firstScalar(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const clean = String(value).trim();
      if (clean) return clean;
    }
  }
  return '';
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const clean = nonEmptyString(value).replace(/\s+/g, ' ');
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

/**
 * Normalize the string/object/array location variants used in Tesla state
 * payloads. Exported for fixture-only tests; it performs no I/O.
 */
export function formatTeslaLocation(value) {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  if (Array.isArray(value)) {
    return uniqueStrings(value.map(formatTeslaLocation)).join(' | ');
  }
  if (!value || typeof value !== 'object') return '';

  const display = firstString(value, [
    'displayName', 'display_name', 'formatted', 'formattedAddress',
    'formatted_address', 'label', 'locationName', 'location_name', 'address', 'name', 'title',
  ]);
  if (display) return display;

  return uniqueStrings([
    firstString(value, ['city', 'locality']),
    firstString(value, ['state', 'stateName', 'state_name', 'province', 'region']),
    firstString(value, ['country', 'countryName', 'country_name', 'countryCode', 'country_code']),
  ]).join(', ');
}

function normalizePostedAt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 0 && value < 10_000_000_000 ? value * 1000 : value;
    return Number.isFinite(new Date(milliseconds).getTime()) ? milliseconds : undefined;
  }
  const clean = nonEmptyString(value);
  if (!clean) return undefined;
  const parsed = Date.parse(clean);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function slugifyTitle(title) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function absoluteTeslaJobUrl(rawUrl, title, id) {
  let candidate = nonEmptyString(rawUrl);
  if (!candidate && title && id) {
    const slug = slugifyTitle(title);
    if (slug) candidate = `/careers/search/job/${slug}-${encodeURIComponent(id)}`;
  }
  if (!candidate) return '';

  let parsed;
  try {
    parsed = new URL(candidate, TESLA_SEARCH_URL);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' || !['tesla.com', 'www.tesla.com'].includes(parsed.hostname.toLowerCase())) return '';

  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const jobPath = pathname.toLowerCase().includes('/careers/search/job/');
  const searchWithId = pathname.toLowerCase().startsWith('/careers/search')
    && ['id', 'jobId', 'job_id'].some(key => parsed.searchParams.has(key));
  if (!jobPath && !searchWithId) return '';

  parsed.hash = '';
  return parsed.toString();
}

function locationFromRecord(record) {
  for (const key of [
    'locations', 'location', 'locationName', 'location_name', 'jobLocation',
    'job_location', 'jobLocations', 'job_locations', 'workLocations', 'work_locations',
  ]) {
    const location = formatTeslaLocation(record?.[key]);
    if (location) return location;
  }
  return uniqueStrings([
    firstString(record, ['city', 'locality']),
    firstString(record, ['state', 'stateName', 'state_name', 'province', 'region']),
    firstString(record, ['country', 'countryName', 'country_name', 'countryCode', 'country_code']),
  ]).join(', ');
}

/**
 * Convert one possible Tesla state record to the scanner's canonical offer
 * shape. A title, a Tesla job URL (explicit or derivable), and a location are
 * all required so a layout change cannot silently bypass location filtering.
 */
export function normalizeTeslaJob(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const title = firstString(record, TITLE_KEYS);
  const id = firstScalar(record, ID_KEYS);
  const url = absoluteTeslaJobUrl(firstString(record, URL_KEYS), title, id);
  const location = locationFromRecord(record);
  if (!title || !url || !location) return null;

  let postedAt;
  for (const key of DATE_KEYS) {
    postedAt = normalizePostedAt(record[key]);
    if (postedAt !== undefined) break;
  }

  return {
    url,
    company: 'Tesla',
    title,
    location,
    source: 'tesla',
    ...(postedAt !== undefined ? { postedAt } : {}),
  };
}

function parseJsonText(text) {
  const clean = nonEmptyString(text).replace(/^\)\]\}',?\s*/, '');
  if (!clean) throw new TeslaScanError('Tesla state endpoint returned an empty response');
  try {
    return JSON.parse(clean);
  } catch (error) {
    throw new TeslaScanError('Tesla state endpoint did not return valid JSON', error);
  }
}

/**
 * Parse Tesla's careers state response without depending on one wrapper key.
 * The endpoint has moved result arrays between releases, while individual job
 * records retain the canonical title/location/id-or-URL fields. The bounded
 * recursive walk accepts those wrapper changes and ignores unrelated state.
 */
export function parseTeslaState(input) {
  const root = typeof input === 'string' ? parseJsonText(input) : input;
  if (!root || typeof root !== 'object') return [];

  const jobs = [];
  const jobUrls = new Set();
  const visited = new WeakSet();
  let inspected = 0;

  function visit(value, depth) {
    if (!value || typeof value !== 'object' || depth > 24 || inspected >= 100_000) return;
    if (visited.has(value)) return;
    visited.add(value);
    inspected += 1;

    if (!Array.isArray(value)) {
      const job = normalizeTeslaJob(value);
      if (job) {
        const key = normalizeUrlForDedup(job.url);
        if (!jobUrls.has(key)) {
          jobUrls.add(key);
          jobs.push(job);
        }
      }
    }

    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) visit(child, depth + 1);
  }

  visit(root, 0);
  return jobs;
}

/**
 * Apply the exact shared scan.mjs title/location semantics and URL dedup.
 * The caller's Set is copied, keeping this helper deterministic and side-effect
 * free for fixture tests.
 */
export function filterTeslaJobs(jobs, { titleFilter, locationFilter, seenUrls = new Set() } = {}) {
  const matchesTitle = buildTitleFilter(titleFilter);
  const matchesLocation = buildLocationFilter(locationFilter);
  const seen = new Set(Array.from(seenUrls, normalizeUrlForDedup));
  const matches = [];
  const titleSkipped = [];
  const locationSkipped = [];
  const duplicateSkipped = [];

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || typeof job !== 'object' || !job.url) continue;
    const key = normalizeUrlForDedup(job.url);
    if (!matchesTitle(job.title)) {
      seen.add(key);
      titleSkipped.push(job);
      continue;
    }
    if (!matchesLocation(job.location, job.url, job.title)) {
      seen.add(key);
      locationSkipped.push(job);
      continue;
    }
    if (seen.has(key)) {
      duplicateSkipped.push(job);
      continue;
    }
    seen.add(key);
    matches.push(job);
  }

  return { matches, titleSkipped, locationSkipped, duplicateSkipped, seen };
}

function loadConfig() {
  if (!existsSync(PORTALS_PATH)) return {};
  try {
    return yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) || {};
  } catch (error) {
    throw new TeslaScanError(`Could not parse ${PORTALS_PATH}: ${error.message}`, error);
  }
}

async function loadChromium() {
  try {
    const playwright = await import('playwright');
    if (!playwright.chromium) throw new Error('chromium export is missing');
    return playwright.chromium;
  } catch (error) {
    throw new TeslaScanError(
      'Playwright is unavailable. Run npm install, then npx playwright install chromium.',
      error,
    );
  }
}

async function fetchStateInPage(page) {
  const response = await page.evaluate(async (endpoint) => {
    try {
      const result = await fetch(endpoint, {
        method: 'GET',
        credentials: 'include',
        headers: {
          accept: 'application/json, text/plain, */*',
          'x-requested-with': 'XMLHttpRequest',
        },
      });
      return {
        ok: result.ok,
        status: result.status,
        statusText: result.statusText,
        text: await result.text(),
      };
    } catch (error) {
      return { ok: false, status: 0, statusText: '', text: '', networkError: String(error?.message || error) };
    }
  }, TESLA_STATE_URL);

  if (response.networkError) {
    throw new TeslaScanError(`Tesla state request failed in the browser: ${response.networkError}`);
  }
  if (!response.ok) {
    const blocked = [401, 403, 429].includes(response.status) ? ' (request blocked or rate-limited)' : '';
    throw new TeslaScanError(`Tesla state endpoint returned HTTP ${response.status} ${response.statusText || ''}${blocked}`.trim());
  }

  const jobs = parseTeslaState(response.text);
  if (jobs.length === 0) {
    throw new TeslaScanError('Tesla state JSON contained no recognizable job records; its schema may have changed');
  }
  return jobs;
}

async function dismissCookieBanner(page) {
  const labels = [/accept all/i, /accept cookies/i, /^accept$/i, /allow all/i, /agree/i];
  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible({ timeout: 750 }).catch(() => false)) {
      await button.click({ timeout: 3000 }).catch(() => null);
      return;
    }
  }
}

async function blockedPageDiagnostic(page) {
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const signal = `${title}\n${body.slice(0, 5000)}`;
  if (/access denied|request blocked|temporarily blocked|verify (?:you are|that you are) human|captcha|unusual traffic|too many requests/i.test(signal)) {
    return 'Tesla returned an anti-bot or rate-limit page';
  }
  return '';
}

async function expandRenderedResults(page) {
  let stableRounds = 0;
  let previousCount = 0;

  for (let round = 0; round < 30 && stableRounds < 3; round += 1) {
    const loadMore = page.getByRole('button', { name: /load more|show more|view more|more jobs/i }).first();
    if (await loadMore.isVisible({ timeout: 500 }).catch(() => false)) {
      await loadMore.click({ timeout: 3000 }).catch(() => null);
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(750);

    const count = await page.locator(TESLA_JOB_ANCHORS).count();
    if (count > previousCount) {
      previousCount = count;
      stableRounds = 0;
    } else {
      stableRounds += 1;
    }
  }
}

async function extractRenderedJobs(page) {
  const rows = await page.$$eval(TESLA_JOB_ANCHORS, anchors => anchors.map(anchor => {
    const card = anchor.closest('article, li, [role="listitem"], [data-testid*="job"], [class*="job"], [class*="result"], [class*="card"]')
      || anchor.parentElement;
    const titleElement = card?.querySelector('h1, h2, h3, h4, [data-testid*="title"], [class*="title"]');
    const locationElement = card?.querySelector('[data-testid*="location"], [class*="location"], [class*="address"], [class*="city"]');
    const title = titleElement?.textContent?.trim()
      || anchor.getAttribute('aria-label')?.trim()
      || anchor.textContent?.trim()
      || '';
    const cardLines = (card?.innerText || '').split('\n').map(line => line.trim()).filter(Boolean);
    const inferredLocation = cardLines.find(line =>
      line !== title
      && (/remote|hybrid|on-?site/i.test(line)
        || /,/.test(line)
        || /\b(?:united states|usa|canada|mexico|germany|france|china|india|japan|australia|united kingdom)\b/i.test(line))
    ) || '';
    const location = locationElement?.textContent?.trim()
      || anchor.getAttribute('data-location')?.trim()
      || card?.getAttribute('data-location')?.trim()
      || inferredLocation
      || '';
    return { title, location, href: anchor.href };
  }));

  const jobs = [];
  const seen = new Set();
  for (const row of rows) {
    const job = normalizeTeslaJob({ title: row.title, location: row.location, jobUrl: row.href });
    if (!job) continue;
    const key = normalizeUrlForDedup(job.url);
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push(job);
  }
  return jobs;
}

async function fetchRenderedSearch(page) {
  const response = await page.goto(TESLA_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (response && response.status() >= 400) {
    throw new TeslaScanError(`Tesla careers search returned HTTP ${response.status()}`);
  }
  await dismissCookieBanner(page);

  await page.waitForSelector(TESLA_JOB_ANCHORS, { timeout: 20_000 }).catch(() => null);
  const blocked = await blockedPageDiagnostic(page);
  if (blocked) throw new TeslaScanError(blocked);

  await expandRenderedResults(page);
  const jobs = await extractRenderedJobs(page);
  if (jobs.length === 0) {
    throw new TeslaScanError('Tesla search rendered no recognizable job cards; the selector layout may have changed');
  }
  return jobs;
}

async function scrapeTesla() {
  const chromium = await loadChromium();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new TeslaScanError(
      'Playwright could not launch Chromium. Run npx playwright install chromium and retry.',
      error,
    );
  }

  const diagnostics = [];
  try {
    const context = await browser.newContext({
      locale: 'en-CA',
      timezoneId: 'America/Edmonton',
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();

    try {
      const response = await page.goto(TESLA_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (response && response.status() >= 400) {
        diagnostics.push(`Initial Tesla careers navigation returned HTTP ${response.status()}`);
      }
      await dismissCookieBanner(page);
      const jobs = await fetchStateInPage(page);
      return { jobs, method: 'json', diagnostics };
    } catch (error) {
      diagnostics.push(`JSON path failed: ${error.message}`);
    }

    try {
      const jobs = await fetchRenderedSearch(page);
      return { jobs, method: 'dom', diagnostics };
    } catch (error) {
      diagnostics.push(`DOM fallback failed: ${error.message}`);
      throw new TeslaScanError(
        `Tesla scrape failed through both browser paths. ${diagnostics.join(' | ')}`,
        error,
      );
    } finally {
      await context.close().catch(() => null);
    }
  } finally {
    await browser.close().catch(() => null);
  }
}

function parseArgs(argv) {
  const known = new Set(['--dry-run', '--summary', '--help', '-h']);
  const unknown = argv.filter(arg => !known.has(arg));
  if (unknown.length > 0) {
    throw new TeslaScanError(`Unknown option: ${unknown[0]}\n\n${USAGE}`);
  }
  return {
    dryRun: argv.includes('--dry-run'),
    summary: argv.includes('--summary'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function truncateCell(value, width) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function renderOffersTable(offers) {
  if (offers.length === 0) return [];
  const widths = { company: 10, title: 44, location: 34 };
  const header = `  ${'Company'.padEnd(widths.company)} | ${'Title'.padEnd(widths.title)} | ${'Location'.padEnd(widths.location)} | URL`;
  const divider = `  ${'-'.repeat(widths.company)}-+-${'-'.repeat(widths.title)}-+-${'-'.repeat(widths.location)}-+----`;
  return [
    header,
    divider,
    ...offers.map(offer => `  ${truncateCell(offer.company, widths.company).padEnd(widths.company)} | ${truncateCell(offer.title, widths.title).padEnd(widths.title)} | ${truncateCell(offer.location, widths.location).padEnd(widths.location)} | ${offer.url}`),
  ];
}

function printSummary(result) {
  const line = '━'.repeat(45);
  console.log(`${line}\nTesla Scan — ${result.date}\n${line}`);
  console.log(`Fetch path:         ${result.method}`);
  console.log(`Total found:        ${result.counts.found}`);
  console.log(`Filtered by title:  ${result.counts.filteredTitle}`);
  console.log(`Filtered location:  ${result.counts.filteredLocation}`);
  console.log(`Duplicates:         ${result.counts.duplicates}`);
  console.log(`New offers:         ${result.counts.newAdded}`);

  if (result.diagnostics.length > 0) {
    console.log('\nDiagnostics:');
    for (const diagnostic of result.diagnostics) console.log(`  ! ${diagnostic}`);
  }
  if (result.newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const row of renderOffersTable(result.newOffers)) console.log(row);
  }
  if (result.dryRun) console.log('\n(dry run — not saved)');
  else if (result.newOffers.length > 0) console.log('\nSaved to data/pipeline.md and data/scan-history.tsv');
  console.log('\n→ Run /career-ops pipeline to evaluate new offers.');
}

async function persistResult(filtered, result) {
  if (filtered.matches.length > 0) await appendToPipeline(filtered.matches);
  if (filtered.matches.length > 0) appendToScanHistory(filtered.matches, result.date, 'added');
  if (filtered.titleSkipped.length > 0) appendToScanHistory(filtered.titleSkipped, result.date, 'skipped_title');
  if (filtered.locationSkipped.length > 0) appendToScanHistory(filtered.locationSkipped, result.date, 'skipped_location');
  if (filtered.duplicateSkipped.length > 0) appendToScanHistory(filtered.duplicateSkipped, result.date, 'skipped_dup');

  appendScanRunSummary({
    timestamp: new Date().toISOString(),
    status: 'completed',
    companies: 1,
    boards: 1,
    found: result.counts.found,
    filteredTitle: result.counts.filteredTitle,
    filteredTier: 0,
    filteredLocation: result.counts.filteredLocation,
    filteredPostingAge: 0,
    filteredSalary: 0,
    filteredContent: 0,
    filteredCooldown: 0,
    dupes: result.counts.duplicates,
    newAdded: result.counts.newAdded,
    errors: result.counts.errors,
    filteredBlacklist: 0,
    filteredVisa: 0,
    filteredPostedDate: 0,
    filteredCountryEligibility: 0,
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const config = loadConfig();
  const scrape = await scrapeTesla();
  const { seen } = loadSeenUrls();
  const filtered = filterTeslaJobs(scrape.jobs, {
    titleFilter: config.title_filter,
    locationFilter: config.location_filter,
    seenUrls: seen,
  });
  const date = new Date().toISOString().slice(0, 10);
  const result = {
    scanner: 'tesla',
    date,
    dryRun: options.dryRun,
    method: scrape.method,
    counts: {
      found: scrape.jobs.length,
      filteredTitle: filtered.titleSkipped.length,
      filteredLocation: filtered.locationSkipped.length,
      duplicates: filtered.duplicateSkipped.length,
      newAdded: filtered.matches.length,
      errors: scrape.diagnostics.length,
    },
    diagnostics: scrape.diagnostics,
    newOffers: filtered.matches,
  };

  if (!options.dryRun) await persistResult(filtered, result);
  if (options.summary) printSummary(result);
  else console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Tesla scan failed: ${error.message}`);
    process.exitCode = 1;
  });
}
