import { createRequire } from 'node:module';
import { pass, fail } from '../helpers.mjs';

console.log('\nHub — ANSI rendering');
const require = createRequire(import.meta.url);
const { ansiToHtml, createAnsiRenderer } = require('../../hub/assets/ansi.js');

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

let renderer = createAnsiRenderer();
assertEqual(
  renderer.push('\x1b[36mfirst'),
  '<span class="a-cyan">first</span>',
  'stateful renderer applies color in the first chunk',
);
assertEqual(
  renderer.push('second'),
  '<span class="a-cyan">second</span>',
  'SGR color persists across chunks',
);

renderer = createAnsiRenderer();
assertEqual(renderer.push('\x1b['), '', 'split CSI prefix is buffered');
assertEqual(
  renderer.push('36mhi'),
  '<span class="a-cyan">hi</span>',
  'split CSI sequence is completed without leaking control text',
);

renderer = createAnsiRenderer();
assertEqual(renderer.push('before\x1b]0;title'), 'before', 'split OSC payload is buffered');
assertEqual(renderer.push('\x07after'), 'after', 'split OSC payload is stripped after its terminator');

renderer = createAnsiRenderer();
assertEqual(
  renderer.push('\x1b[31m<script class="bad">'),
  '<span class="a-red">&lt;script class=&quot;bad&quot;&gt;</span>',
  'stateful output escapes HTML and emits only whitelisted ANSI classes',
);

renderer = createAnsiRenderer();
assertEqual(
  renderer.push('\x1b[38;2;255;0;0mtruecolor text'),
  'truecolor text',
  'truecolor SGR parameters do not corrupt following text',
);
