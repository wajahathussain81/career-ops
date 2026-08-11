import { appendFile } from 'node:fs/promises';

await new Promise(r => setTimeout(r, 50));

if (process.argv[3] === 'Nope') {
  console.error('bad state');
  process.exit(3);
}

await appendFile(new URL('.status-calls', import.meta.url), `${process.argv[2]} ${process.argv[3]}\n`);
process.exit(0);
