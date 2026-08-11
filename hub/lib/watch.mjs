import { existsSync, watch } from 'node:fs';
import { join, sep } from 'node:path';

const conflicts = new Set();

function relativePath(base, filename) {
  const suffix = filename == null ? '' : String(filename);
  return join(base, suffix).split(sep).join('/');
}

export function getConflicts() {
  return [...conflicts].sort();
}

export function watchPaths(root, relPaths, { onChange, onConflict } = {}) {
  const watchers = [];
  const changed = new Set();
  const conflictCandidates = new Set();
  let timer = null;
  let closed = false;

  const flush = () => {
    timer = null;
    if (closed) return;

    for (const file of conflicts) {
      if (!existsSync(join(root, file))) conflicts.delete(file);
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
    if (newConflicts.length) onConflict?.(newConflicts.sort());
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 300);
  };

  for (const relPath of relPaths) {
    const absPath = join(root, relPath);
    if (!existsSync(absPath)) continue;

    try {
      const fsWatcher = watch(absPath, { recursive: true }, (_event, filename) => {
        const file = relativePath(relPath, filename);
        changed.add(file);
        if (file.includes('.sync-conflict')) conflictCandidates.add(file);
        schedule();
      });
      fsWatcher.on('error', () => fsWatcher.close());
      watchers.push(fsWatcher);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
      for (const fsWatcher of watchers) fsWatcher.close();
      throw error;
    }
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      for (const fsWatcher of watchers) fsWatcher.close();
    },
  };
}
