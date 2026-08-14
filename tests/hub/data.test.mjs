import { pass, fail, ROOT } from '../helpers.mjs';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nHub — data readers');
const FIX = join(ROOT, 'tests/hub/fixtures');
const d = await import(pathToFileURL(join(ROOT, 'hub/lib/data.mjs')).href);
const { renderContacts } = await import(pathToFileURL(join(ROOT, 'hub/views/contacts.mjs')).href);

const apps = d.loadApplications(FIX);
if (apps.length === 4 && apps[0].company === 'Acme Robotics' && apps[0].num === 1) pass('loadApplications parses 4 rows');
else fail(`apps: ${JSON.stringify(apps[0])} len=${apps.length}`);
if (apps[0].score === '4.5/5' && apps[0].status === 'Interview') pass('score/status columns correct');
else fail(`score=${apps[0].score} status=${apps[0].status}`);

const log = d.loadStatusLog(FIX);
if (log.length === 6 && log[2].to === 'Interview' && log[2].num === 1) pass('status log parsed');
else fail(`log len=${log.length}`);

const joined = d.getApplication(FIX, 1);
if (joined.app.company === 'Acme Robotics' && joined.timeline.length === 3) pass('join: timeline attached');
else fail(`timeline=${joined.timeline.length}`);
if (joined.contacts.length === 1 && joined.contacts[0].name === 'Jane Doe') pass('join: contacts attached');
else fail(`contacts=${JSON.stringify(joined.contacts)}`);
if (joined.reportFile && joined.reportFile.endsWith('001-acme-robotics-2026-08-01.md')) pass('join: report resolved');
else fail(`reportFile=${joined.reportFile}`);
if (joined.prep && joined.prep.slug === 'acme-firmware-1') pass('join: prep dir matched by -num suffix');
else fail(`prep=${JSON.stringify(joined.prep)}`);
if (joined.resume?.exists === true && joined.resume.source === 'upload'
  && joined.resume.path.includes('ACME-1')) pass('join: missing pdf-index file falls back to upload resume');
else fail(`resume=${JSON.stringify(joined.resume)}`);
if (!joined.resume.path.includes('OTHER-11')) pass('join: upload directory suffix matches tracker number exactly');
else fail(`resume incorrectly matched tracker 11 directory: ${JSON.stringify(joined.resume)}`);

const packages = d.listPackages(FIX);
if (packages.length === 2 && packages[0].num === 11 && packages[1].num === 1) {
  pass('packages: upload directories are listed newest first');
} else fail(`packages=${JSON.stringify(packages)}`);
const trackedPackage = packages.find(item => item.num === 1);
if (trackedPackage?.company === 'Acme Robotics'
  && trackedPackage.role === 'Firmware Engineer'
  && trackedPackage.status === 'Interview'
  && trackedPackage.score === '4.5/5'
  && trackedPackage.date === '2026-08-01'
  && trackedPackage.hasResume === true
  && trackedPackage.hasCover === true
  && trackedPackage.reportNum === '001') {
  pass('packages: tracker context and generated artifacts are joined');
} else fail(`tracked package=${JSON.stringify(trackedPackage)}`);
const unmatchedPackage = packages.find(item => item.num === 11);
if (unmatchedPackage?.company === 'OTHER'
  && unmatchedPackage.role === null
  && unmatchedPackage.hasResume === true
  && unmatchedPackage.hasCover === false
  && unmatchedPackage.reportNum === null) {
  pass('packages: unmatched upload directory uses slug fallback');
} else fail(`unmatched package=${JSON.stringify(unmatchedPackage)}`);

const cover = d.resolveCover(FIX, 1);
if (cover?.exists === true && cover.path.endsWith('ACME-1/Test-Cover-Letter.pdf')) {
  pass('resolveCover finds the tracker-number upload PDF');
} else fail(`cover=${JSON.stringify(cover)}`);
if (d.resolveCover(FIX, 2) === null) pass('resolveCover returns null when no cover exists');
else fail(`missing cover=${JSON.stringify(d.resolveCover(FIX, 2))}`);

const unsyncedResume = d.getApplication(FIX, 2)?.resume;
if (unsyncedResume?.path === 'output/cv-beta.pdf' && unsyncedResume.exists === false) {
  pass('join: missing pdf-index file remains as an unsynced fallback');
} else fail(`resume=${JSON.stringify(unsyncedResume)}`);

const noResume = d.getApplication(FIX, 3);
if (noResume?.resume === null) pass('join: application without pdf-index or upload resume stays null');
else fail(`resume=${JSON.stringify(noResume?.resume)}`);

const fu = d.loadFollowUps(FIX);
if (fu.length === 2 && fu[0].appNum === 2) pass('follow-ups parsed'); else fail(`fu=${JSON.stringify(fu)}`);

const unifiedContacts = d.loadUnifiedContacts(FIX);
const alan = unifiedContacts.find(contact => contact.name === 'Alan Johnstone');
if (alan?.title === 'Sr Eng Manager, test engineering, Ottawa'
  && alan.company === 'Gamma Inc'
  && alan.source === 'follow-up') {
  pass('unified contacts parse follow-up name and title');
} else fail(`follow-up contact=${JSON.stringify(alan)}`);

const sams = unifiedContacts.filter(contact => contact.name === 'Sam Lee' && contact.company === 'Beta Corp');
if (sams.length === 1 && sams[0].source === 'contact' && sams[0].title === 'Eng Manager') {
  pass('unified contacts prefer the structured record when stores overlap');
} else fail(`deduped contacts=${JSON.stringify(sams)}`);

if (alan?.tracker === 3) pass('unified contacts carry follow-up application numbers');
else fail(`follow-up tracker=${JSON.stringify(alan?.tracker)}`);

const unifiedContactsHtml = renderContacts(unifiedContacts);
if (unifiedContactsHtml.includes('Alan Johnstone')
  && unifiedContactsHtml.includes('href="/apps/3"')) {
  pass('contacts page renders follow-up-derived people with application links');
} else fail(`unified contacts output=${unifiedContactsHtml}`);

if (d.loadPipelineCount(FIX) === 2) pass('pipeline count'); else fail(`pipeline=${d.loadPipelineCount(FIX)}`);
if (d.loadApplications(join(FIX, 'nonexistent')).length === 0) pass('missing root degrades to []');
else fail('missing root did not degrade');

const divergedRoot = mkdtempSync(join(tmpdir(), 'career-ops-hub-data-'));
try {
  cpSync(FIX, divergedRoot, { recursive: true });
  writeFileSync(join(divergedRoot, 'data/applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 9 | 2026-08-09 | Report First | Engineer | 4.2/5 | Evaluated | ✅ | [57](../reports/057-report-first-2026-08-09.md) | |
| 10 | 2026-08-10 | Legacy Fallback | Engineer | 4.1/5 | Evaluated | ✅ | [58](../reports/058-legacy-fallback-2026-08-10.md) | |
`);
  writeFileSync(join(divergedRoot, 'data/pdf-index.tsv'), [
    '057\toutput/report-057.pdf\toutput/report-057.html\tletter\t2026-08-09',
    '009\toutput/tracker-009.pdf\toutput/tracker-009.html\tletter\t2026-08-09',
    '010\toutput/tracker-010.pdf\toutput/tracker-010.html\tletter\t2026-08-10',
    '',
  ].join('\n'));
  mkdirSync(join(divergedRoot, 'jds'), { recursive: true });
  mkdirSync(join(divergedRoot, 'output'), { recursive: true });
  writeFileSync(join(divergedRoot, 'output/report-057.pdf'), 'report pdf');
  writeFileSync(join(divergedRoot, 'output/tracker-009.pdf'), 'tracker pdf');
  writeFileSync(join(divergedRoot, 'output/tracker-010.pdf'), 'fallback pdf');
  writeFileSync(join(divergedRoot, 'jds/report-057-role.md'), '# report JD');
  writeFileSync(join(divergedRoot, 'jds/tracker-009-role.md'), '# tracker JD');
  writeFileSync(join(divergedRoot, 'jds/tracker-010-role.md'), '# fallback JD');

  const reportFirst = d.getApplication(divergedRoot, 9);
  if (reportFirst?.resume?.path === 'output/report-057.pdf'
    && reportFirst.jdFile?.endsWith('report-057-role.md')) {
    pass('join: report number wins when tracker and report numbers diverge');
  } else fail(`report-first artifacts=${JSON.stringify(reportFirst)}`);

  const legacyFallback = d.getApplication(divergedRoot, 10);
  if (legacyFallback?.resume?.path === 'output/tracker-010.pdf'
    && legacyFallback.jdFile?.endsWith('tracker-010-role.md')) {
    pass('join: tracker number remains the artifact fallback');
  } else fail(`fallback artifacts=${JSON.stringify(legacyFallback)}`);
} finally {
  rmSync(divergedRoot, { recursive: true, force: true });
}
