import { createRequire } from 'node:module';
import { pass, fail } from '../helpers.mjs';

console.log('\nHub — ANSI rendering');
const require = createRequire(import.meta.url);
const { ansiToHtml } = require('../../hub/assets/ansi.js');

function assertEqual(actual, expected, label) {
  if (actual === expected) pass(label);
  else fail(`${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

assertEqual(
  ansiToHtml('\x1b[32mOK\x1b[0m'),
  '<span class="a-green">OK</span>',
  'green SGR is span-wrapped without raw escapes',
);
assertEqual(
  ansiToHtml('<script>alert("x")</script>'),
  '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
  'HTML input is escaped',
);
assertEqual(
  ansiToHtml('\x1b[2K\x1b[1Gready'),
  'ready',
  'cursor-movement sequences are stripped',
);
assertEqual(
  ansiToHtml('line1\rline2'),
  'line2',
  'carriage-return rewrites collapse to final content',
);
assertEqual(
  ansiToHtml('plain text'),
  'plain text',
  'plain text passes through unchanged',
);
