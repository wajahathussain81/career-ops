let tail = Promise.resolve(); export function withLock(fn){ const p = tail.then(fn, fn); tail = p.catch(() => {}); return p; }
