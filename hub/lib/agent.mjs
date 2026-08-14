import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const PREAMBLE = "Hub run. House rules: never submit/send/apply to anything; never run git; tracker writes only via node set-status.mjs or the batch TSV + merge-tracker.mjs flow; user-facing content only from cv.md/article-digest.md/profile files.";
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;

const OUTPUT_TRUNCATION_MARKER = '…[output truncated]…\n';

let current = null;

export function buildArgv(worker, prompt) {
  if (worker === 'codex') return ['codex', 'exec', '--json', prompt];
  if (worker === 'claude') {
    return ['claude', '-p', '--output-format', 'stream-json', '--verbose', prompt];
  }
  throw new Error(`Unknown worker: ${worker}`);
}

function truncateLabel(value) {
  const label = String(value ?? '').trim();
  return label.length <= 120 ? label : `${label.slice(0, 119)}…`;
}

function commandLabel(command) {
  let label = String(command ?? '').trim()
    .replace(/^\/bin\/(?:zsh|bash)\s+-lc\s+/, '');
  if (label.length >= 2 && ((label.startsWith("'") && label.endsWith("'"))
    || (label.startsWith('"') && label.endsWith('"')))) {
    label = label.slice(1, -1);
  }
  return truncateLabel(label);
}

function fileChangeLabel(changes) {
  return truncateLabel((Array.isArray(changes) ? changes : [])
    .map(change => `${change?.kind || 'change'} ${basename(String(change?.path || 'file'))}`)
    .join(', ') || 'file change');
}

function codexAction(item) {
  if (item?.type === 'command_execution') {
    return { icon: 'command', label: commandLabel(item.command) };
  }
  if (item?.type === 'file_change') {
    return { icon: 'file', label: fileChangeLabel(item.changes) };
  }
  if (item?.type === 'web_search') {
    return {
      icon: 'search',
      label: truncateLabel(item.query ?? item.input?.query ?? 'web search'),
    };
  }
  if (item?.type === 'mcp_tool_call') {
    const server = item.server ?? item.server_name ?? item.mcp_server ?? '';
    const tool = item.tool ?? item.tool_name ?? item.name ?? '';
    return { icon: 'tool', label: truncateLabel([server, tool].filter(Boolean).join(' ') || 'tool') };
  }
  return null;
}

function claudeAction(block) {
  const name = String(block?.name || 'tool');
  const input = block?.input && typeof block.input === 'object' ? block.input : {};
  if (name === 'Bash') {
    return { icon: 'command', label: truncateLabel(input.command || name) };
  }
  if (['Edit', 'Write', 'Read'].includes(name)) {
    const file = input.file_path ? basename(String(input.file_path)) : '';
    return { icon: 'file', label: truncateLabel([name, file].filter(Boolean).join(' ')) };
  }
  return { icon: 'tool', label: truncateLabel(name) };
}

function transcriptFragment(event, output) {
  let fragment = '';
  if (event.kind === 'message') fragment = event.text;
  else if (event.kind === 'action' && event.phase === 'end') {
    fragment = `$ ${event.label} … ${event.ok ? 'ok' : 'failed'}\n`;
  } else if (event.kind === 'error') {
    const text = String(event.text);
    fragment = `! ${text}${text.endsWith('\n') ? '' : '\n'}`;
  }
  if (!fragment) return '';
  if (output && !output.endsWith('\n')) return `\n${fragment}`;
  return fragment;
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
  onEvent = () => {},
  onExit = () => {},
  logDir = join(root, 'hub', 'logs'),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  killProcess = process.kill,
}) {
  if (current) throw new Error('busy');

  const argv = workerCmd || buildArgv(worker, `${PREAMBLE}\n\n${prompt}`);
  const env = { ...process.env };
  delete env.HUB_TOKEN;
  delete env.HUB_COOKIE_SECURE;
  const child = spawn(argv[0], argv.slice(1), {
    cwd: root,
    detached: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let timer;
  let killTimer;
  let stderrTail = Buffer.alloc(0);
  const liveActions = new Map();

  const emitEvent = event => {
    output += transcriptFragment(event, output);
    if (output.length > MAX_OUTPUT_BYTES) {
      output = OUTPUT_TRUNCATION_MARKER + output.slice(-MAX_OUTPUT_BYTES);
    }
    onEvent(event);
  };

  const processCodexLine = line => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    const item = event.item;
    if (event.type === 'turn.completed') {
      const inputTokens = event.usage?.input_tokens;
      const outputTokens = event.usage?.output_tokens;
      if (typeof inputTokens === 'number' && typeof outputTokens === 'number') {
        emitEvent({ kind: 'usage', inputTokens, outputTokens });
      }
      return;
    }
    if (event.type === 'item.completed'
      && item?.type === 'agent_message'
      && typeof item.text === 'string'
      && item.text.length > 0) {
      emitEvent({ kind: 'message', text: item.text });
      return;
    }
    if (item?.type === 'reasoning'
      && ['item.started', 'item.completed'].includes(event.type)) {
      emitEvent({ kind: 'status', text: 'thinking…' });
      return;
    }
    const action = codexAction(item);
    if (action && event.type === 'item.started') {
      const normalized = {
        kind: 'action',
        phase: 'start',
        id: String(item.id),
        ...action,
      };
      liveActions.set(normalized.id, action);
      emitEvent(normalized);
      return;
    }
    if (action && ['item.completed', 'item.failed'].includes(event.type)) {
      const id = String(item.id);
      const normalized = {
        kind: 'action',
        phase: 'end',
        id,
        ...(liveActions.get(id) || action),
        ok: item.exit_code === 0 || item.status === 'completed',
      };
      liveActions.delete(id);
      emitEvent(normalized);
      return;
    }
    if (event.type === 'error') {
      emitEvent({ kind: 'error', text: String(event.message || 'Worker error') });
    }
  };

  const processClaudeLine = line => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    if (event.type === 'assistant') {
      const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
      for (const block of blocks) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
          emitEvent({ kind: 'message', text: block.text });
        } else if (block?.type === 'thinking') {
          emitEvent({ kind: 'status', text: 'thinking…' });
        } else if (block?.type === 'tool_use') {
          const action = claudeAction(block);
          const id = String(block.id);
          liveActions.set(id, action);
          emitEvent({ kind: 'action', phase: 'start', id, ...action });
        }
      }
      return;
    }
    if (event.type === 'user') {
      const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
      for (const block of blocks) {
        if (block?.type !== 'tool_result') continue;
        const id = String(block.tool_use_id);
        const action = liveActions.get(id) || { icon: 'tool', label: 'tool' };
        liveActions.delete(id);
        emitEvent({
          kind: 'action',
          phase: 'end',
          id,
          ...action,
          ok: !block.is_error,
        });
      }
      return;
    }
    if (event.type === 'result') {
      const inputTokens = event.usage?.input_tokens;
      const outputTokens = event.usage?.output_tokens;
      if (typeof inputTokens === 'number' && typeof outputTokens === 'number') {
        emitEvent({ kind: 'usage', inputTokens, outputTokens });
      }
      if (event.subtype !== 'success') {
        emitEvent({
          kind: 'error',
          text: String(event.message || event.error || event.result || event.subtype || 'Worker error'),
        });
      }
    }
  };

  const sendSignal = signal => {
    try {
      killProcess(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };

  const run = {
    kill() {
      sendSignal('SIGTERM');
      if (!killTimer) {
        killTimer = setTimer(() => sendSignal('SIGKILL'), 5000);
        killTimer.unref();
      }
    },
  };
  current = run;

  const stdoutDecoder = new StringDecoder('utf8');
  let stdoutBuffer = '';
  const processLine = worker === 'codex' ? processCodexLine : processClaudeLine;
  child.stdout.on('data', chunk => {
    stdoutBuffer += stdoutDecoder.write(chunk);
    let newlineIndex;
    while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
      processLine(stdoutBuffer.slice(0, newlineIndex));
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
    }
  });
  child.stdout.once('end', () => {
    stdoutBuffer += stdoutDecoder.end();
    if (stdoutBuffer) processLine(stdoutBuffer);
    stdoutBuffer = '';
  });
  child.stderr.on('data', chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stderrTail = Buffer.concat([stderrTail, bytes]);
    if (stderrTail.length > MAX_STDERR_BYTES) {
      stderrTail = stderrTail.subarray(stderrTail.length - MAX_STDERR_BYTES);
    }
  });
  child.on('error', error => emitEvent({ kind: 'error', text: error.message }));
  child.once('close', async code => {
    clearTimer(timer);
    if (killTimer) clearTimer(killTimer);
    if (current === run) current = null;
    if (code !== 0 && stderrTail.length > 0) {
      emitEvent({ kind: 'error', text: stderrTail.toString('utf8') });
    }
    try {
      await appendTranscript(logDir, worker, prompt, output);
    } catch {
      // A logging failure must not keep the shared run lock held forever.
    } finally {
      onExit(code);
    }
  });

  timer = setTimer(() => run.kill(), 30 * 60 * 1000);
  timer.unref();
  return run;
}
