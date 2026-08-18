import { existsSync, readdirSync, watch } from 'node:fs';
import { join, sep } from 'node:path';

const conflicts = new Set();

function relativePath(base, filename) {
  const suffix = filename == null ? '' : String(filename);
  return join(base, suffix).split(sep).join('/');
}

export function getConflicts() {
  return [...conflicts].sort();
}

function scanConflicts(root, relPath) {
  const found = [];
  const pending = [relPath];

  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = readdirSync(join(root, current), { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOTDIR') {
        if (current.includes('.sync-conflict')) found.push(current.split(sep).join('/'));
        continue;
      }
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.name.includes('.sync-conflict')) found.push(file.split(sep).join('/'));
    }
  }

  return found;
}

export function watchPaths(root, relPaths, { onChange, onConflict, watchImpl = watch } = {}) {
  const watchers = new Set();
  const retryTimers = new Set();
  const changed = new Set();
  const conflictCandidates = new Set();
  let timer = null;
  let closed = false;

  const conflictsBeforeScan = getConflicts();
  for (const file of conflicts) {
    if (!existsSync(join(root, file))) conflicts.delete(file);
  }
  for (const relPath of relPaths) {
    if (!existsSync(join(root, relPath))) continue;
    for (const file of scanConflicts(root, relPath)) conflicts.add(file);
  }
  if (JSON.stringify(getConflicts()) !== JSON.stringify(conflictsBeforeScan)) {
    onConflict?.(getConflicts());
  }

  const flush = () => {
    timer = null;
    if (closed) return;

    let conflictPruned = false;
    for (const file of conflicts) {
      if (!existsSync(join(root, file))) {
        conflicts.delete(file);
        conflictPruned = true;
      }
    }

    const newConflicts = [];
    for (const file of conflictCandidates) {
      if (existsSync(join(root, file)) && !conflicts.has(file)) {
        conflicts.add(file);
        newConflicts.push(file);
      }
    }

    const changedPaths = [...changed].sort();
    changed.clear();
    conflictCandidates.clear();

    if (changedPaths.length) onChange?.(changedPaths);
    if (newConflicts.length || conflictPruned) {
      onConflict?.(getConflicts());
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 300);
  };

  const arm = (relPath, isRetry = false) => {
    const absPath = join(root, relPath);
    if (closed || !existsSync(absPath)) return;

    try {
      let retryScheduled = false;
      const fsWatcher = watchImpl(absPath, { recursive: true }, (_event, filename) => {
        const file = relativePath(relPath, filename);
        changed.add(file);
        if (file.includes('.sync-conflict')) conflictCandidates.add(file);
        schedule();
      });
      fsWatcher.on('error', (error) => {
        console.error(`Career Ops Hub watcher error for ${relPath}: ${error.message}`);
        fsWatcher.close();
        watchers.delete(fsWatcher);
        if (closed || isRetry || retryScheduled) return;
        retryScheduled = true;
        const retryTimer = setTimeout(() => {
          retryTimers.delete(retryTimer);
          try {
            arm(relPath, true);
          } catch (retryError) {
            console.error(`Career Ops Hub watcher re-arm failed for ${relPath}: ${retryError.message}`);
          }
        }, 500);
        retryTimer.unref?.();
        retryTimers.add(retryTimer);
      });
      watchers.add(fsWatcher);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return;
      throw error;
    }
  };

  try {
    for (const relPath of relPaths) arm(relPath);
  } catch (error) {
    for (const fsWatcher of watchers) fsWatcher.close();
    throw error;
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      for (const retryTimer of retryTimers) clearTimeout(retryTimer);
      for (const fsWatcher of watchers) fsWatcher.close();
    },
  };
}
