function initAppsPage() {
  const form = document.querySelector('#apps-form');
  const tbody = document.querySelector('#apps-tbody');
  if (!form || !tbody) return;

  const total = document.querySelector('#apps-total');
  const sortButtons = [...document.querySelectorAll('.apps-table .th-sort')];
  const activeSortButton = sortButtons.find(button => button.closest('th')?.hasAttribute('aria-sort'));
  let sortKey = activeSortButton?.dataset.sort || '';
  let sortDir = activeSortButton?.closest('th')?.getAttribute('aria-sort') === 'descending'
    ? 'desc'
    : 'asc';
  let timer;
  let refreshController;
  const updateSortHeaders = (nextSort, nextDir) => {
    sortKey = sortButtons.some(button => button.dataset.sort === nextSort) ? nextSort : '';
    sortDir = nextDir === 'desc' ? 'desc' : 'asc';
    for (const button of sortButtons) {
      const th = button.closest('th');
      const caret = button.querySelector('.sort-caret');
      const active = button.dataset.sort === sortKey;
      if (active) th?.setAttribute('aria-sort', sortDir === 'desc' ? 'descending' : 'ascending');
      else th?.removeAttribute('aria-sort');
      if (caret) caret.textContent = active ? (sortDir === 'desc' ? '▼' : '▲') : '';
    }
  };
  const refresh = async () => {
    refreshController?.abort();
    const controller = new AbortController();
    refreshController = controller;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (String(value).trim()) params.set(key, value);
    }
    if (sortKey) {
      params.set('sort', sortKey);
      params.set('dir', sortDir);
    }
    try {
      const response = await fetch(`/api/apps?${params}`, { signal: controller.signal });
      if (!response.ok) return;
      const data = await response.json();
      if (controller.signal.aborted) return;
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
      updateSortHeaders(data.sort, data.dir);
    } catch (error) {
      if (error?.name === 'AbortError' || refreshController !== controller) return;
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'Could not refresh applications.';
      row.append(cell);
      tbody.replaceChildren(row);
      if (total) total.textContent = '—';
    } finally {
      if (refreshController === controller) refreshController = undefined;
    }
  };

  form.addEventListener('submit', event => { event.preventDefault(); refresh(); });
  form.addEventListener('change', refresh);
  form.querySelector('[name="q"]')?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 180);
  });
  for (const button of sortButtons) {
    button.addEventListener('click', () => {
      if (button.dataset.sort === sortKey) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else {
        sortKey = button.dataset.sort;
        sortDir = 'asc';
      }
      refresh();
    });
  }
}

function initSortableTables() {
  const parseNumber = value => {
    const normalized = value.replace(/\/5$/, '').replace(/[%$,]/g, '').trim();
    if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  };
  const compare = (left, right, direction) => {
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;

    const leftNumber = parseNumber(left);
    const rightNumber = parseNumber(right);
    let result;
    if (leftNumber !== null && rightNumber !== null) result = leftNumber - rightNumber;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(left) && /^\d{4}-\d{2}-\d{2}$/.test(right)) {
      result = left.localeCompare(right);
    } else result = left.localeCompare(right, undefined, { sensitivity: 'base' });
    return direction === 'descending' ? -result : result;
  };

  for (const table of document.querySelectorAll('table')) {
    if (table.classList.contains('apps-table') || table.hasAttribute('data-sortable-init')) continue;
    const headers = [...(table.tHead?.querySelectorAll('th') || [])];
    const tbody = table.tBodies[0];
    if (!headers.length || !tbody || tbody.rows.length < 2) continue;

    table.setAttribute('data-sortable-init', '');
    let activeHeader;
    let activeDirection = 'ascending';
    const sortBy = header => {
      activeDirection = activeHeader === header && activeDirection === 'ascending'
        ? 'descending'
        : 'ascending';
      activeHeader = header;
      for (const item of headers) {
        item.removeAttribute('aria-sort');
        const caret = item.querySelector('.sort-caret');
        if (caret) caret.textContent = '';
      }
      header.setAttribute('aria-sort', activeDirection);
      const caret = header.querySelector('.sort-caret');
      if (caret) caret.textContent = activeDirection === 'descending' ? '▼' : '▲';

      const currentTbody = table.tBodies[0];
      if (!currentTbody) return;
      const column = header.cellIndex;
      const rows = [...currentTbody.rows];
      rows.sort((left, right) => compare(
        left.cells[column]?.textContent.trim() || '',
        right.cells[column]?.textContent.trim() || '',
        activeDirection,
      ));
      currentTbody.append(...rows);
    };

    for (const header of headers) {
      header.setAttribute('role', 'button');
      header.tabIndex = 0;
      const caret = document.createElement('span');
      caret.className = 'sort-caret';
      caret.setAttribute('aria-hidden', 'true');
      header.append(caret);
      header.addEventListener('click', () => sortBy(header));
      header.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        header.click();
      });
    }
  }
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
  const tablists = document.querySelectorAll('[role="tablist"]');
  for (const tablist of tablists) {
    const tabs = [...tablist.querySelectorAll('[data-tab-target]')];
    if (!tabs.length) continue;

    const activate = (tab, moveFocus = false) => {
      for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
        const pane = document.getElementById(item.dataset.tabTarget);
        if (pane) {
          pane.hidden = !selected;
          if (selected) requestAnimationFrame(() => {
            pane.dispatchEvent(new CustomEvent('hub:tab-shown', { bubbles: true }));
          });
        }
      }
      if (moveFocus) tab.focus();

      const countdown = tab.closest('.bar')?.querySelector('[data-tab-countdown]');
      if (countdown && tab.dataset.countdownDt) {
        countdown.dataset.dt = tab.dataset.countdownDt;
        updateCountdown(countdown);
      }
    };

    const selected = tabs.find(tab => tab.getAttribute('aria-selected') === 'true') || tabs[0];
    for (const tab of tabs) {
      tab.tabIndex = tab === selected ? 0 : -1;
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', event => {
        const current = tabs.indexOf(tab);
        let next = current;
        if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault();
        activate(tabs[next], true);
      });
    }
  }
}

const INTERVIEW_WINDOW_MS = 72 * 60 * 60 * 1000;
const countdownParts = new WeakMap();

function buildCountdown(element) {
  const prefix = document.createElement('span');
  prefix.className = 'countdown-prefix';
  const segments = document.createElement('span');
  const started = document.createElement('b');
  started.textContent = 'started';
  started.hidden = true;
  const digits = [];
  const labels = [];

  if (element.classList.contains('countdown-hero')) {
    segments.className = 'countdown-hero-segments';
    for (const unit of ['d', 'h', 'm', 's']) {
      const number = document.createElement('b');
      const label = document.createElement('span');
      label.className = 'countdown-unit';
      label.textContent = unit;
      digits.push(number);
      labels.push(label);
      segments.append(number, label);
    }

    const track = document.createElement('span');
    track.className = 'countdown-progress';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', '72 hour interview window elapsed');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const fill = document.createElement('span');
    fill.className = 'countdown-progress-fill';
    track.append(fill);
    element.replaceChildren(prefix, segments, started, track);
    return { prefix, segments, started, digits, labels, track, fill };
  }

  segments.className = 'countdown-segments';
  for (const separator of [' ', ':', ':', '']) {
    const number = document.createElement('b');
    digits.push(number);
    segments.append(number, document.createTextNode(separator));
  }
  element.replaceChildren(prefix, segments, started);
  return { prefix, segments, started, digits, labels };
}

function getCountdownParts(element) {
  if (!countdownParts.has(element)) countdownParts.set(element, buildCountdown(element));
  return countdownParts.get(element);
}

function updateCountdownProgress(parts, remaining) {
  if (!parts.track || !parts.fill) return;
  const elapsedShare = Math.min(1, Math.max(0, 1 - (remaining / INTERVIEW_WINDOW_MS)));
  const percentage = Math.round(elapsedShare * 100);
  parts.track.setAttribute('aria-valuenow', String(percentage));
  parts.fill.style.width = `${elapsedShare * 100}%`;
}

function updateCountdown(element) {
  const target = Date.parse(element.dataset.dt || '');
  if (!Number.isFinite(target)) return;
  const remaining = target - Date.now();
  const parts = getCountdownParts(element);
  if (remaining <= 0) {
    parts.prefix.textContent = 'interview status';
    parts.prefix.hidden = !element.classList.contains('countdown-hero');
    parts.segments.hidden = true;
    parts.started.hidden = false;
    updateCountdownProgress(parts, 0);
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
  parts.prefix.textContent = 'starts in';
  parts.prefix.hidden = false;
  parts.segments.hidden = false;
  parts.started.hidden = true;

  if (element.classList.contains('countdown-hero')) {
    for (const [index, value] of [days, hourText, minuteText, secondText].entries()) {
      parts.digits[index].textContent = String(value);
    }
    updateCountdownProgress(parts, remaining);
  } else {
    for (const [index, value] of [`${days}d`, hourText, minuteText, secondText].entries()) {
      parts.digits[index].textContent = String(value);
    }
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
      } else {
        error.textContent = data.error || `Status update failed (${response.status}).`;
        error.hidden = false;
      }
    } catch {
      error.textContent = 'Status update failed. Please try again.';
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

function initPackageActions() {
  const buttons = [...document.querySelectorAll('.pkg-apply')];
  if (!buttons.length) return;

  const timers = new Map();
  const disarm = button => {
    clearTimeout(timers.get(button));
    timers.delete(button);
    button.classList.remove('pkg-apply-armed');
    button.textContent = 'Mark applied';
  };
  const arm = button => {
    for (const other of buttons) {
      if (other !== button) disarm(other);
    }
    button.classList.add('pkg-apply-armed');
    button.textContent = 'Confirm applied?';
    timers.set(button, setTimeout(() => disarm(button), 4000));
  };

  for (const button of buttons) {
    button.addEventListener('click', async () => {
      if (!button.classList.contains('pkg-apply-armed')) {
        arm(button);
        return;
      }

      clearTimeout(timers.get(button));
      timers.delete(button);
      button.classList.remove('pkg-apply-armed');
      button.disabled = true;
      button.textContent = 'Marking…';
      try {
        const response = await fetch('/api/status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            num: Number(button.dataset.num),
            state: 'Applied',
            note: `Applied ${new Date().toISOString().slice(0, 10)} via hub Packages tab`,
          }),
        });
        const data = await response.json();
        if (!response.ok || data.ok !== true) throw new Error(data.stderr || data.error);

        const row = button.closest('tr');
        const tbody = row?.parentElement;
        const table = row?.closest('table');
        row?.remove();
        if (tbody && tbody.rows.length === 0 && table) {
          const empty = document.createElement('p');
          empty.textContent = 'No pending packages — stage one under output/upload/';
          (table.closest('.table-scroll') || table).replaceWith(empty);
        }
      } catch {
        button.disabled = false;
        button.textContent = 'Failed — retry';
      }
    });
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('.pkg-apply')) return;
    for (const button of buttons) disarm(button);
  });
}

function initPrepWorkspace() {
  const workspaces = [...document.querySelectorAll('[data-prep-workspace]')];
  if (!workspaces.length) return null;

  const selfChanges = new Map();
  let deferredReload = null;
  const editorSelector = '[data-prep-editor], [data-prep-add-input]';

  const autoGrow = editor => {
    if (!editor?.matches('textarea')) return;
    editor.style.height = 'auto';
    if (editor.scrollHeight) editor.style.height = `${editor.scrollHeight}px`;
  };
  const editorState = (editor, state, text) => {
    editor.dataset.dirty = String(state !== 'saved');
    const form = editor.closest('form');
    const indicator = form?.querySelector('[data-prep-save-state]');
    if (indicator) {
      indicator.dataset.state = state;
      indicator.textContent = text;
    }
  };
  const initEditor = editor => {
    editor.dataset.savedValue = editor.value;
    editor.dataset.dirty = 'false';
    autoGrow(editor);
  };
  const isBlocked = () => {
    const focused = document.activeElement?.matches?.(editorSelector)
      && document.activeElement.closest('[data-prep-workspace]');
    return Boolean(focused || document.querySelector(
      '[data-prep-editor][data-dirty="true"], [data-prep-add-input][data-dirty="true"]',
    ));
  };
  const flush = () => {
    if (!deferredReload || isBlocked()) return;
    const reload = deferredReload;
    deferredReload = null;
    reload();
  };
  const setAddState = (form, state, text) => {
    const indicator = form.querySelector('[data-prep-add-state]');
    if (!indicator) return;
    indicator.dataset.state = state;
    indicator.textContent = text;
  };
  const markSelfWrite = (workspace, filename) => {
    const slug = workspace?.dataset.prepSlug;
    if (!slug) return;
    selfChanges.set(`${slug}/${filename}`, Date.now() + 2500);
  };
  const consumeSelfChange = paths => {
    const now = Date.now();
    for (const [key, expiry] of selfChanges) {
      if (expiry < now) selfChanges.delete(key);
    }
    if (!paths.length || !selfChanges.size) return false;
    const matchedKeys = new Set();
    const onlySelfChanges = paths.every(path => {
      for (const key of selfChanges.keys()) {
        const split = key.lastIndexOf('/');
        const slug = key.slice(0, split);
        const filename = key.slice(split + 1);
        const finalPath = `interview-prep/${slug}/${filename}`;
        const tempPrefix = `interview-prep/${slug}/.${filename}.`;
        if (path === finalPath || path.startsWith(tempPrefix)) {
          matchedKeys.add(key);
          return true;
        }
      }
      return false;
    });
    if (onlySelfChanges) {
      for (const key of matchedKeys) selfChanges.delete(key);
    }
    return onlySelfChanges;
  };
  const postJson = async (endpoint, payload) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) throw new Error(data.error || `Save failed (${response.status}).`);
    return data;
  };
  const buildQuestionCard = question => {
    const card = document.createElement('article');
    card.className = 'prep-qa-card';
    card.dataset.questionId = question.id;

    const header = document.createElement('header');
    header.className = 'prep-qa-card-head';
    const prompt = document.createElement('p');
    prompt.className = 'prep-question-text';
    prompt.textContent = question.q;
    const badge = document.createElement('span');
    badge.className = 'prep-source-badge source-user';
    badge.textContent = 'user';
    header.append(prompt, badge);

    const agentAnswer = document.createElement('div');
    agentAnswer.className = 'prep-agent-answer';
    const agentLabel = document.createElement('span');
    agentLabel.className = 'prep-answer-label';
    agentLabel.textContent = 'AGENT';
    const agentEmpty = document.createElement('p');
    agentEmpty.className = 'prep-agent-answer-empty';
    agentEmpty.textContent = 'No agent response yet — ask the agent to draft one.';
    agentAnswer.append(agentLabel, agentEmpty);

    const form = document.createElement('form');
    form.dataset.prepAnswerForm = '';
    const userLabel = document.createElement('span');
    userLabel.className = 'prep-answer-label';
    userLabel.textContent = 'YOU';
    const textarea = document.createElement('textarea');
    textarea.name = 'answer';
    textarea.dataset.prepEditor = '';
    textarea.dataset.prepAnswer = '';
    textarea.dataset.questionId = question.id;
    textarea.placeholder = 'Draft your answer in Markdown…';
    textarea.setAttribute('aria-label', `Answer to ${question.q}`);
    textarea.value = question.answer || '';
    const saveRow = document.createElement('div');
    saveRow.className = 'prep-save-row';
    const state = document.createElement('span');
    state.className = 'prep-save-state';
    state.dataset.prepSaveState = '';
    state.dataset.state = 'saved';
    state.setAttribute('aria-live', 'polite');
    state.textContent = 'SAVED';
    const button = document.createElement('button');
    button.type = 'submit';
    button.dataset.prepSaveAnswer = '';
    button.textContent = 'Save answer';
    saveRow.append(state, button);
    form.append(userLabel, textarea, saveRow);
    card.append(header, agentAnswer, form);
    initEditor(textarea);
    return card;
  };

  for (const editor of document.querySelectorAll('[data-prep-editor]')) initEditor(editor);
  for (const input of document.querySelectorAll('[data-prep-add-input]')) {
    input.dataset.dirty = String(Boolean(input.value));
  }

  document.addEventListener('input', event => {
    const editor = event.target.closest?.('[data-prep-editor]');
    if (editor) {
      autoGrow(editor);
      const clean = editor.value === editor.dataset.savedValue;
      editorState(editor, clean ? 'saved' : 'unsaved', clean ? 'SAVED' : 'UNSAVED');
      return;
    }
    const addInput = event.target.closest?.('[data-prep-add-input]');
    if (addInput) {
      addInput.dataset.dirty = String(Boolean(addInput.value));
      setAddState(addInput.closest('form'), addInput.value ? 'unsaved' : 'saved',
        addInput.value ? 'UNSAVED' : '');
    }
  });

  document.addEventListener('keydown', event => {
    if (event.isComposing || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    const editor = event.target.closest?.('[data-prep-editor]');
    if (!editor) return;
    event.preventDefault();
    editor.closest('form')?.requestSubmit();
  });

  document.addEventListener('submit', async event => {
    const answerForm = event.target.closest?.('[data-prep-answer-form]');
    const notesForm = event.target.closest?.('[data-prep-notes-form]');
    const questionForm = event.target.closest?.('[data-prep-question-form]');
    if (!answerForm && !notesForm && !questionForm) return;
    event.preventDefault();

    const form = answerForm || notesForm || questionForm;
    const workspace = form.closest('[data-prep-workspace]');
    const slug = workspace?.dataset.prepSlug;
    if (!slug) return;

    if (questionForm) {
      const input = questionForm.querySelector('[data-prep-add-input]');
      const button = questionForm.querySelector('button[type="submit"]');
      const q = input?.value.trim() || '';
      if (!q) {
        setAddState(questionForm, 'error', 'QUESTION REQUIRED');
        return;
      }
      button.disabled = true;
      setAddState(questionForm, 'saving', 'SAVING…');
      try {
        markSelfWrite(workspace, 'qa.yml');
        const data = await postJson('/api/prep/question', {
          slug,
          section: questionForm.dataset.section,
          q,
        });
        const section = questionForm.closest('.sec');
        section?.querySelector('[data-prep-question-list]')?.append(buildQuestionCard(data.question));
        section?.classList.remove('prep-qa-empty');
        section?.querySelector('.prep-qa-empty-copy')?.remove();
        input.value = '';
        input.dataset.dirty = 'false';
        setAddState(questionForm, 'saved', 'ADDED');
        flush();
      } catch {
        input.dataset.dirty = 'true';
        setAddState(questionForm, 'error', 'ERROR · RETRY');
      } finally {
        button.disabled = false;
      }
      return;
    }

    const editor = form.querySelector('[data-prep-editor]');
    const button = form.querySelector('button[type="submit"]');
    const submittedValue = editor.value;
    button.disabled = true;
    editorState(editor, 'saving', 'SAVING…');
    try {
      if (answerForm) {
        markSelfWrite(workspace, 'qa.yml');
        await postJson('/api/prep/answer', {
          slug,
          id: editor.dataset.questionId,
          answer: submittedValue,
        });
      } else {
        markSelfWrite(workspace, 'notes.md');
        await postJson('/api/prep/notes', { slug, notes: submittedValue });
      }
      editor.dataset.savedValue = submittedValue;
      const clean = editor.value === submittedValue;
      editorState(editor, clean ? 'saved' : 'unsaved', clean ? 'SAVED' : 'UNSAVED');
      flush();
    } catch {
      editorState(editor, 'error', 'ERROR · RETRY');
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener('focusout', event => {
    if (event.target.closest?.('[data-prep-workspace]')) setTimeout(flush, 0);
  });
  document.addEventListener('hub:tab-shown', event => {
    for (const editor of event.target.querySelectorAll?.('[data-prep-editor]') || []) autoGrow(editor);
  });
  window.addEventListener('resize', () => {
    for (const editor of document.querySelectorAll('[data-prep-editor]')) autoGrow(editor);
  });

  return {
    isBlocked,
    consumeSelfChange,
    deferReload(callback) {
      deferredReload = callback;
    },
  };
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
  const usage = consoleElement.querySelector('#chat-usage');
  const newOutput = consoleElement.querySelector('#chat-new-output');
  const workers = [...consoleElement.querySelectorAll('[name="worker"]')];
  if (!form || !transcript || !promptInput || !kill
    || !stateLabel || !elapsed || !usage || !newOutput || !workers.length) return null;

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
  const liveActions = new Map();
  let statusElement = null;
  let scaffoldingTimer;
  let spinnerFrame = 0;
  const TRANSCRIPT_NODE_CAP = 5000;
  const SPINNER_FRAMES = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'];
  const THINKING_VERBS = [
    'pondering',
    'reasoning',
    'analyzing',
    'synthesizing',
    'mulling',
    'computing',
    'formulating',
  ];
  const THINKING_VERB_WIDTH = Math.max(...THINKING_VERBS.map(verb => verb.length));
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    || { matches: false };
  const ACTION_ICONS = {
    command: '❯',
    file: '✎',
    search: '⌕',
    tool: '⚙',
  };

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
  const formatActionDuration = (milliseconds) => {
    const seconds = Math.max(0, milliseconds / 1000);
    return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
  };
  const formatTokens = value => {
    const tokens = Math.max(0, Number(value) || 0);
    if (tokens < 1000) return String(Math.round(tokens));
    const thousands = tokens / 1000;
    return thousands < 10 ? `${thousands.toFixed(1)}k` : `${Math.round(thousands)}k`;
  };
  const updateActionTime = (row, now = Date.now()) => {
    const time = row.querySelector('.chat-action-time');
    if (!time) return;
    const start = Number(row.dataset.startedAt) || now;
    const end = Number(row.dataset.endedAt) || now;
    time.textContent = `(${formatActionDuration(end - start)})`;
  };
  const updateStatus = (now = Date.now()) => {
    if (!statusElement) return;
    const duration = Math.max(0, now - startedAt);
    const verbIndex = reducedMotion.matches
      ? 0
      : Math.floor(duration / 2500) % THINKING_VERBS.length;
    const verb = THINKING_VERBS[verbIndex];
    const verbElement = statusElement.querySelector('.chat-status-verb');
    const timeElement = statusElement.querySelector('.chat-status-time');
    if (verbElement) verbElement.textContent = `${verb.padEnd(THINKING_VERB_WIDTH)}…`;
    if (timeElement) timeElement.textContent = `· ${Math.floor(duration / 1000)}s`;
  };
  const stopScaffoldingTimer = () => {
    clearInterval(scaffoldingTimer);
    scaffoldingTimer = undefined;
  };
  const tickScaffolding = () => {
    const spinners = transcript.querySelectorAll(
      '.chat-action-state.spinner, .chat-status-glyph.spinner',
    );
    const frame = reducedMotion.matches ? '⠿' : SPINNER_FRAMES[spinnerFrame];
    for (const spinner of spinners) spinner.textContent = frame;
    if (!reducedMotion.matches) spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;

    const now = Date.now();
    for (const row of liveActions.values()) updateActionTime(row, now);
    updateStatus(now);
    if (!spinners.length) stopScaffoldingTimer();
  };
  const syncScaffoldingTimer = () => {
    tickScaffolding();
    if (!scaffoldingTimer && transcript.querySelector(
      '.chat-action-state.spinner, .chat-status-glyph.spinner',
    )) {
      scaffoldingTimer = setInterval(tickScaffolding, 90);
    }
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
  const capTranscript = () => {
    while (transcript.childNodes.length > TRANSCRIPT_NODE_CAP) {
      const removed = transcript.firstChild;
      if (removed === statusElement) statusElement = null;
      const actionId = removed?.dataset?.actionId;
      if (actionId && liveActions.get(actionId) === removed) liveActions.delete(actionId);
      removed?.remove();
    }
    syncScaffoldingTimer();
  };
  const appendLine = (text, className) => {
    const line = document.createElement('div');
    line.className = className;
    line.textContent = text;
    transcript.append(line);
    capTranscript();
    afterOutput();
    return line;
  };
  const removeStatus = () => {
    statusElement?.remove();
    statusElement = null;
    syncScaffoldingTimer();
  };
  const appendMessage = text => appendLine(String(text || ''), 'chat-msg');
  const actionElement = (event) => {
    const row = document.createElement('div');
    row.className = 'chat-action';
    row.dataset.actionId = String(event.id || '');
    row.dataset.startedAt = String(Date.now());
    row.tabIndex = 0;

    const state = document.createElement('span');
    state.className = 'chat-action-state spinner';
    state.textContent = reducedMotion.matches ? '⠿' : SPINNER_FRAMES[spinnerFrame];
    state.setAttribute('aria-hidden', 'true');

    const icon = document.createElement('span');
    icon.className = 'chat-action-icon';
    icon.textContent = ACTION_ICONS[event.icon] || ACTION_ICONS.tool;
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'chat-action-label';
    label.textContent = String(event.label || 'tool');

    const time = document.createElement('span');
    time.className = 'chat-action-time';
    row.append(state, icon, label, time);
    updateActionTime(row);
    return row;
  };
  const completeAction = (row, ok) => {
    if (!row.dataset.endedAt) row.dataset.endedAt = String(Date.now());
    const state = row.querySelector('.chat-action-state');
    if (state) {
      state.className = `chat-action-state ${ok ? 'ok' : 'failed'}`;
      state.textContent = ok ? '✓' : '✗';
    }
    row.classList.add('done');
    row.classList.toggle('failed', !ok);
    updateActionTime(row);
    syncScaffoldingTimer();
  };
  const appendAction = event => {
    let row = liveActions.get(String(event.id || ''));
    if (event.phase === 'start') {
      if (row) row.remove();
      row = actionElement(event);
      liveActions.set(String(event.id || ''), row);
      transcript.append(row);
    } else {
      if (!row) {
        row = actionElement(event);
        transcript.append(row);
      }
      completeAction(row, Boolean(event.ok));
      liveActions.delete(String(event.id || ''));
    }
    capTranscript();
    syncScaffoldingTimer();
    afterOutput();
  };
  const showStatus = () => {
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.className = 'chat-status';
      statusElement.setAttribute('role', 'status');

      const glyph = document.createElement('span');
      glyph.className = 'chat-status-glyph spinner';
      glyph.setAttribute('aria-hidden', 'true');
      const verb = document.createElement('span');
      verb.className = 'chat-status-verb';
      const time = document.createElement('span');
      time.className = 'chat-status-time';
      statusElement.append(glyph, verb, time);
    }
    transcript.append(statusElement);
    capTranscript();
    syncScaffoldingTimer();
    afterOutput();
  };
  const showUsage = event => {
    if (typeof event.inputTokens !== 'number' || typeof event.outputTokens !== 'number') return;
    usage.textContent = `↑${formatTokens(event.inputTokens)} ↓${formatTokens(event.outputTokens)}`;
    usage.hidden = false;
  };
  const collapseRunActions = () => {
    const children = [...transcript.children];
    let promptIndex = -1;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      if (children[index].classList.contains('terminal-command')) {
        promptIndex = index;
        break;
      }
    }
    const rows = children.slice(promptIndex + 1)
      .filter(element => element.classList.contains('chat-action'));
    if (rows.length < 3) return;
    const collapsibleRows = rows.filter(row => !row.classList.contains('failed'));
    if (!collapsibleRows.length) return;

    const group = document.createElement('div');
    group.className = 'chat-action-group';
    const summary = document.createElement('button');
    summary.className = 'chat-action-summary';
    summary.type = 'button';
    summary.setAttribute('aria-expanded', 'false');
    const arrow = document.createElement('span');
    arrow.className = 'chat-action-summary-arrow';
    arrow.textContent = '▸';
    arrow.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = `${rows.length} actions · ${formatActionDuration(Date.now() - startedAt)}`;
    summary.append(arrow, label);

    const details = document.createElement('div');
    details.className = 'chat-action-details';
    details.hidden = true;
    group.append(summary, details);
    rows[0].before(group);
    details.append(...collapsibleRows);
    summary.addEventListener('click', () => {
      details.hidden = !details.hidden;
      const expanded = !details.hidden;
      summary.setAttribute('aria-expanded', String(expanded));
      arrow.textContent = expanded ? '▾' : '▸';
      afterOutput();
    });
    afterOutput();
  };
  const dispatchEvent = event => {
    if (!event || typeof event !== 'object') return;
    if (event.kind === 'status') {
      showStatus(event.text);
      return;
    }
    removeStatus();
    if (event.kind === 'message') appendMessage(event.text);
    else if (event.kind === 'action') appendAction(event);
    else if (event.kind === 'error') appendLine(String(event.text || 'Worker error'), 'chat-error');
    else if (event.kind === 'usage') showUsage(event);
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
    usage.hidden = true;
    usage.textContent = '';
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
        appendLine('! a run is already active', 'chat-error');
        return;
      }
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Could not start the run.');
      }
    } catch (error) {
      appendLine(`! ${error.message}`, 'chat-error');
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
      appendLine(`! ${error.message}`, 'chat-error');
      kill.disabled = false;
    }
  });

  resizePrompt();
  requestAnimationFrame(() => promptInput.focus());

  return {
    setBusy,
    isRunning: () => busy,
    onEvent(data) {
      setBusy(true);
      dispatchEvent(data);
    },
    onExit(data) {
      removeStatus();
      const successful = data.code === 0;
      for (const row of liveActions.values()) completeAction(row, successful);
      liveActions.clear();
      stopScaffoldingTimer();
      collapseRunActions();
      if (!successful) appendLine(`✗ exit ${data.code ?? '?'}`, 'chat-exit chat-exit-error');
      setBusy(false);
      promptInput.focus();
    },
  };
}

function initLive(chat, prepWorkspace) {
  if (!window.EventSource) return;
  if (document.querySelector('form[action="/login"], input[name="token"]')) return;

  const events = new EventSource('/api/events');
  let lastReload = 0;
  events.addEventListener('open', async () => {
    try {
      const response = await fetch('/api/chat/status');
      if (!response.ok) return;
      const data = await response.json();
      if (typeof data.running === 'boolean') chat?.setBusy(data.running);
    } catch {
      // Reconciliation is best-effort; the next event or reconnect can retry it.
    }
  });
  events.addEventListener('data-changed', event => {
    if (document.querySelector('[data-chat-console]') || chat?.isRunning()) return;

    let paths = [];
    try {
      const data = JSON.parse(event.data);
      if (Array.isArray(data.paths)) paths = data.paths;
    } catch {
      paths = [];
    }
    if (prepWorkspace?.consumeSelfChange(paths)) return;

    const reload = () => {
      const now = Date.now();
      if (now - lastReload < 5000) return;
      lastReload = now;
      window.location.reload();
    };
    if (prepWorkspace?.isBlocked()) {
      prepWorkspace.deferReload(reload);
      return;
    }

    reload();
  });
  events.addEventListener('conflict', event => {
    const data = JSON.parse(event.data);
    renderConflictBanner(Array.isArray(data.files) ? data.files : []);
  });
  events.addEventListener('chat', event => {
    chat?.onEvent(JSON.parse(event.data));
  });
  events.addEventListener('chat-exit', event => {
    chat?.onExit(JSON.parse(event.data));
  });
}

initAppsPage();
initSortableTables();
initTabs();
initCountdown();
initStatusControl();
initPackageActions();
const prepWorkspace = initPrepWorkspace();
const chat = initChat();
initLive(chat, prepWorkspace);
