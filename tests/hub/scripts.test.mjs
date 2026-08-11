import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nHub — analytics scripts');
const FIX = join(ROOT, 'tests/hub/fixtures');
const { runJson, getStats } = await import(
  pathToFileURL(join(ROOT, 'hub/lib/scripts.mjs')).href
);

const ok = await runJson(FIX, 'ok.mjs');
if (isDeepStrictEqual(ok, { ok: true })) pass('valid JSON output is parsed');
else fail(`valid JSON result=${JSON.stringify(ok)}`);

const bad = await runJson(FIX, 'bad.mjs');
if (bad && typeof bad.__error === 'string') pass('invalid JSON degrades to __error');
else fail(`invalid JSON result=${JSON.stringify(bad)}`);

const missing = await runJson(FIX, 'missing.mjs');
if (missing && typeof missing.__error === 'string') pass('missing script degrades to __error');
else fail(`missing script result=${JSON.stringify(missing)}`);

const stats = await getStats(FIX);
if (stats && typeof stats.__error === 'string') pass('missing stats script degrades to __error');
else fail(`stats result=${JSON.stringify(stats)}`);
