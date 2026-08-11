import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const PREAMBLE = "Hub run. House rules: never submit/send/apply to anything; never run git; tracker writes only via node set-status.mjs or the batch TSV + merge-tracker.mjs flow; user-facing content only from cv.md/article-digest.md/profile files.";

let current = null;

export function buildArgv(worker, prompt) {
  if (worker === 'codex') return ['codex', 'exec', prompt];
  if (worker === 'claude') return ['claude', '-p', prompt];
  throw new Error(`Unknown worker: ${worker}`);
}

function dateParts(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

async function appendTranscript(logDir, worker, prompt, output) {
  const { date, time } = dateParts();
  await mkdir(logDir, { recursive: true });
  const transcript = `## ${time} ${worker}\n${prompt}\n---\n${output}${output.endsWith('\n') ? '' : '\n'}`;
  await appendFile(join(logDir, `${date}.md`), transcript, 'utf8');
}

export function startRun({
  root,
  prompt,
  worker = 'codex',
  workerCmd,
  onChunk = () => {},
  onExit = () => {},
  logDir = join(root, 'hub', 'logs'),
}) {
  if (current) throw new Error('busy');

  const argv = workerCmd || buildArgv(worker, `${PREAMBLE}\n\n${prompt}`);
  const child = spawn(argv[0], argv.slice(1), {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let timer;

  const emitChunk = chunk => {
    const text = String(chunk);
    output += text;
    onChunk(text);
  };

  const run = {
    kill() {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    },
  };
  current = run;

  child.stdout.on('data', emitChunk);
  child.stderr.on('data', emitChunk);
  child.on('error', error => emitChunk(`${error.message}\n`));
  child.once('close', async code => {
    clearTimeout(timer);
    if (current === run) current = null;
    try {
      await appendTranscript(logDir, worker, prompt, output);
    } catch {
      // A logging failure must not keep the shared run lock held forever.
    } finally {
      onExit(code);
    }
  });

  timer = setTimeout(() => run.kill(), 30 * 60 * 1000);
  timer.unref();
  return run;
}
