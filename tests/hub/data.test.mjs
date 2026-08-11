import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nHub — data readers');
const FIX = join(ROOT, 'tests/hub/fixtures');
const d = await import(pathToFileURL(join(ROOT, 'hub/lib/data.mjs')).href);

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

const unsyncedResume = d.getApplication(FIX, 2)?.resume;
if (unsyncedResume?.path === 'output/cv-beta.pdf' && unsyncedResume.exists === false) {
  pass('join: missing pdf-index file remains as an unsynced fallback');
} else fail(`resume=${JSON.stringify(unsyncedResume)}`);

const noResume = d.getApplication(FIX, 3);
if (noResume?.resume === null) pass('join: application without pdf-index or upload resume stays null');
else fail(`resume=${JSON.stringify(noResume?.resume)}`);

const fu = d.loadFollowUps(FIX);
if (fu.length === 1 && fu[0].appNum === 2) pass('follow-ups parsed'); else fail(`fu=${JSON.stringify(fu)}`);
if (d.loadPipelineCount(FIX) === 2) pass('pipeline count'); else fail(`pipeline=${d.loadPipelineCount(FIX)}`);
if (d.loadApplications(join(FIX, 'nonexistent')).length === 0) pass('missing root degrades to []');
else fail('missing root did not degrade');
