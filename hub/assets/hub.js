function initAppsPage() {
  const form = document.querySelector('#apps-form');
  const tbody = document.querySelector('#apps-tbody');
  if (!form || !tbody) return;

  const total = document.querySelector('#apps-total');
  let timer;
  const refresh = async () => {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (String(value).trim()) params.set(key, value);
    }
    const response = await fetch(`/api/apps?${params}`);
    if (!response.ok) return;
    const data = await response.json();
    tbody.replaceChildren(...data.rows.map(row => {
      const tr = document.createElement('tr');
      const values = [row.num, row.date, row.company, row.role, row.score || '—', row.status];
      for (const [index, value] of values.entries()) {
        const td = document.createElement('td');
        if (index === 0 || index === 2) {
          const link = document.createElement('a');
          link.href = `/apps/${encodeURIComponent(row.num)}`;
          link.textContent = index === 0 ? `#${value}` : value;
          td.append(link);
        } else if (index === 5) {
          const chip = document.createElement('span');
          chip.className = `status-chip status-${statusTone(value)}`;
          chip.textContent = value;
          td.append(chip);
        } else td.textContent = value;
        tr.append(td);
      }
      return tr;
    }));
    if (total) total.textContent = data.total;
  };

  form.addEventListener('submit', event => { event.preventDefault(); refresh(); });
  form.addEventListener('change', refresh);
  form.querySelector('[name="q"]')?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 180);
  });
}

function statusTone(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['interview', 'offer', 'hired'].includes(status)) return 'verified';
  if (status === 'rejected') return 'forbidden';
  if (status === 'responded') return 'reasoned';
  if (status === 'applied') return 'applied';
  return 'neutral';
}

function initTabs() {
  const tabs = document.querySelectorAll('[data-tab-target]');
  if (!tabs.length) return;
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const tablist = tab.closest('[role="tablist"]');
      const relatedTabs = tablist?.querySelectorAll('[data-tab-target]') || [tab];
      for (const item of relatedTabs) {
        item.setAttribute('aria-selected', String(item === tab));
        const pane = document.getElementById(item.dataset.tabTarget);
        if (pane) pane.hidden = item !== tab;
      }
      const countdown = tab.closest('.bar')?.querySelector('[data-tab-countdown]');
      if (countdown && tab.dataset.countdownDt) {
        countdown.dataset.dt = tab.dataset.countdownDt;
        updateCountdown(countdown);
      }
    });
  }
}

const INTERVIEW_WINDOW_MS = 72 * 60 * 60 * 1000;

function renderCountdownProgress(element, remaining) {
  const elapsedShare = Math.min(1, Math.max(0, 1 - (remaining / INTERVIEW_WINDOW_MS)));
  const percentage = Math.round(elapsedShare * 100);
  const track = document.createElement('span');
  track.className = 'countdown-progress';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', '72 hour interview window elapsed');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(percentage));
  const fill = document.createElement('span');
  fill.className = 'countdown-progress-fill';
  fill.style.width = `${elapsedShare * 100}%`;
  track.append(fill);
  element.append(track);
}

function updateCountdown(element) {
  const target = Date.parse(element.dataset.dt || '');
  if (!Number.isFinite(target)) return;
  const remaining = target - Date.now();
  if (remaining <= 0) {
    if (element.classList.contains('countdown-hero')) {
      const prefix = document.createElement('span');
      prefix.className = 'countdown-prefix';
      prefix.textContent = 'interview status';
      const started = document.createElement('b');
      started.textContent = 'started';
      element.replaceChildren(prefix, started);
      renderCountdownProgress(element, 0);
    } else element.textContent = 'started';
    element.setAttribute('aria-label', 'started');
    return;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hourText = String(hours).padStart(2, '0');
  const minuteText = String(minutes).padStart(2, '0');
  const secondText = String(seconds).padStart(2, '0');
  const prefix = document.createElement('span');
  prefix.className = 'countdown-prefix';
  prefix.textContent = 'starts in';

  if (element.classList.contains('countdown-hero')) {
    const segments = document.createElement('span');
    segments.className = 'countdown-hero-segments';
    for (const [number, unit] of [[days, 'd'], [hourText, 'h'], [minuteText, 'm'], [secondText, 's']]) {
      const digits = document.createElement('b');
      digits.textContent = String(number);
      const label = document.createElement('span');
      label.className = 'countdown-unit';
      label.textContent = unit;
      segments.append(digits, label);
    }
    element.replaceChildren(prefix, segments);
    renderCountdownProgress(element, remaining);
  } else {
    const segments = document.createElement('span');
    segments.className = 'countdown-segments';
    const dayDigits = document.createElement('b');
    dayDigits.textContent = `${days}d`;
    const hourDigits = document.createElement('b');
    hourDigits.textContent = hourText;
    const minuteDigits = document.createElement('b');
    minuteDigits.textContent = minuteText;
    const secondDigits = document.createElement('b');
    secondDigits.textContent = secondText;
    segments.append(dayDigits, document.createTextNode(' '), hourDigits,
      document.createTextNode(':'), minuteDigits, document.createTextNode(':'), secondDigits);
    element.replaceChildren(prefix, segments);
  }
  element.setAttribute('aria-label', `starts in ${days} days ${hourText} hours ${minuteText} minutes ${secondText} seconds`);
}

function initCountdown() {
  const countdowns = document.querySelectorAll('[data-dt]');
  if (!countdowns.length) return;
  const tick = () => {
    for (const countdown of countdowns) updateCountdown(countdown);
  };
  tick();
  setInterval(tick, 1000);
}

function initStatusControl() {
  const control = document.querySelector('[data-status-control]');
  if (!control) return;

  const select = control.querySelector('[name="state"]');
  const button = control.querySelector('[data-status-apply]');
  const error = control.querySelector('[data-status-error]');
  if (!select || !button || !error) return;

  button.addEventListener('click', async () => {
    button.disabled = true;
    error.hidden = true;
    try {
      const response = await fetch('/api/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ num: Number(control.dataset.num), state: select.value }),
      });
      const data = await response.json();
      if (response.ok) {
        window.location.reload();
        return;
      }
      if (response.status === 422) {
        error.textContent = data.stderr || 'Status update failed.';
        error.hidden = false;
      }
    } catch (requestError) {
      error.textContent = requestError.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

function renderConflictBanner(files) {
  const banner = document.querySelector('#banner');
  if (!banner) return;
  banner.replaceChildren();
  if (!files.length) return;

  const flag = document.createElement('div');
  flag.className = 'flag forbid';
  const title = document.createElement('div');
  title.className = 'flag-t';
  title.textContent = 'Sync conflicts detected';
  const list = document.createElement('ul');
  for (const file of files) {
    const item = document.createElement('li');
    item.textContent = file;
    list.append(item);
  }
  flag.append(title, list);
  banner.append(flag);
}

function initChat() {
  const consoleElement = document.querySelector('[data-chat-console]');
  if (!consoleElement) return null;

  const form = consoleElement.querySelector('#chat-form');
  const transcript = consoleElement.querySelector('#chat-transcript');
  const scrollback = transcript;
  const promptInput = consoleElement.querySelector('#chat-prompt');
  const kill = consoleElement.querySelector('#chat-kill');
  const stateLabel = consoleElement.querySelector('#chat-state');
  const elapsed = consoleElement.querySelector('#chat-elapsed');
  const newOutput = consoleElement.querySelector('#chat-new-output');
  const workers = [...consoleElement.querySelectorAll('[name="worker"]')];
  if (!form || !transcript || !promptInput || !kill
    || !stateLabel || !elapsed || !newOutput || !workers.length) return null;

  const HISTORY_KEY = 'hub-chat-history';
  let history = [];
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (Array.isArray(stored)) history = stored.filter(item => typeof item === 'string').slice(-50);
  } catch {
    history = [];
  }
  let historyIndex = history.length;
  let historyDraft = '';
  let busy = false;
  let startedAt = 0;
  let elapsedTimer;
  let followsOutput = true;

  const formatElapsed = (milliseconds) => {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  };
  const tickElapsed = () => {
    const duration = busy ? Date.now() - startedAt : 0;
    elapsed.textContent = formatElapsed(duration);
    elapsed.dateTime = `PT${Math.floor(duration / 1000)}S`;
  };

  const setBusy = nextBusy => {
    const wasBusy = consoleElement.dataset.running === 'true';
    busy = nextBusy;
    consoleElement.dataset.running = String(nextBusy);
    stateLabel.textContent = nextBusy ? 'running' : 'idle';
    elapsed.hidden = !nextBusy;
    kill.disabled = !nextBusy;
    for (const worker of workers) worker.disabled = nextBusy;

    if (nextBusy && !wasBusy) {
      startedAt = Date.now();
      clearInterval(elapsedTimer);
      elapsedTimer = setInterval(tickElapsed, 1000);
    } else if (!nextBusy && wasBusy) {
      clearInterval(elapsedTimer);
      elapsedTimer = undefined;
    }
    tickElapsed();
  };
  const distanceFromBottom = () => scrollback.scrollHeight
    - scrollback.scrollTop - scrollback.clientHeight;
  const revealOutput = () => {
    requestAnimationFrame(() => {
      scrollback.scrollTop = scrollback.scrollHeight;
      followsOutput = true;
      newOutput.hidden = true;
    });
  };
  const afterOutput = () => {
    if (followsOutput || distanceFromBottom() <= 40) revealOutput();
    else newOutput.hidden = false;
  };
  const appendLine = (text, className) => {
    const line = document.createElement('div');
    line.className = className;
    line.textContent = text;
    transcript.append(line);
    afterOutput();
  };
  const appendChunk = (chunk) => {
    const span = document.createElement('span');
    span.className = 'terminal-chunk';
    if (typeof window.ansiToHtml === 'function') span.innerHTML = window.ansiToHtml(chunk);
    else span.textContent = String(chunk || '');
    transcript.append(span);
    afterOutput();
  };
  const resizePrompt = () => {
    promptInput.style.height = '0px';
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, window.innerHeight * 0.3)}px`;
  };
  const rememberPrompt = (prompt) => {
    history.push(prompt);
    history = history.slice(-50);
    historyIndex = history.length;
    historyDraft = '';
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // History persistence is optional when storage is unavailable.
    }
  };
  const selectHistory = (direction) => {
    if (!history.length) return;
    if (historyIndex === history.length) historyDraft = promptInput.value;
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + direction));
    promptInput.value = historyIndex === history.length ? historyDraft : history[historyIndex];
    resizePrompt();
    promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(form);
    const prompt = String(values.get('prompt') || '').trim();
    if (!prompt) return;
    appendLine(`❯ ${prompt}`, 'terminal-command');
    rememberPrompt(prompt);
    promptInput.value = '';
    resizePrompt();
    setBusy(true);
    promptInput.focus();
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, worker: values.get('worker') || 'codex' }),
      });
      if (response.status === 409) {
        appendLine('! a run is already active', 'terminal-warning');
        return;
      }
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Could not start the run.');
      }
    } catch (error) {
      appendLine(`! ${error.message}`, 'terminal-error');
      setBusy(false);
      promptInput.focus();
    }
  });

  promptInput.addEventListener('input', () => {
    historyIndex = history.length;
    historyDraft = promptInput.value;
    resizePrompt();
  });
  promptInput.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    } else if (event.key === 'ArrowUp' && !event.shiftKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      selectHistory(-1);
    } else if (event.key === 'ArrowDown' && !event.shiftKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      selectHistory(1);
    }
  });

  scrollback.addEventListener('scroll', () => {
    followsOutput = distanceFromBottom() <= 40;
    if (followsOutput) newOutput.hidden = true;
  }, { passive: true });
  newOutput.addEventListener('click', revealOutput);

  kill.addEventListener('click', async () => {
    kill.disabled = true;
    try {
      const response = await fetch('/api/chat/kill', { method: 'POST' });
      if (!response.ok) throw new Error('Could not interrupt the run.');
    } catch (error) {
      appendLine(`! ${error.message}`, 'terminal-error');
      kill.disabled = false;
    }
  });

  resizePrompt();
  requestAnimationFrame(() => promptInput.focus());

  return {
    onChunk(data) {
      setBusy(true);
      appendChunk(data.chunk || '');
    },
    onExit(data) {
      const successful = data.code === 0;
      appendLine(`${successful ? '✓' : '✗'} exit ${data.code ?? '?'}`,
        successful ? 'terminal-exit-success' : 'terminal-exit-error');
      setBusy(false);
      promptInput.focus();
    },
  };
}

function initLive(chat) {
  if (!window.EventSource) return;
  if (document.querySelector('form[action="/login"], input[name="token"]')) return;

  const events = new EventSource('/api/events');
  let lastReload = 0;
  events.addEventListener('data-changed', event => {
    if (typeof window.hubRefresh === 'function') {
      window.hubRefresh(JSON.parse(event.data));
      return;
    }

    const now = Date.now();
    if (now - lastReload < 5000) return;
    lastReload = now;
    window.location.reload();
  });
  events.addEventListener('conflict', event => {
    const data = JSON.parse(event.data);
    renderConflictBanner(Array.isArray(data.files) ? data.files : []);
  });
  events.addEventListener('chat', event => {
    chat?.onChunk(JSON.parse(event.data));
  });
  events.addEventListener('chat-exit', event => {
    chat?.onExit(JSON.parse(event.data));
  });
}

initAppsPage();
initTabs();
initCountdown();
initStatusControl();
const chat = initChat();
initLive(chat);
