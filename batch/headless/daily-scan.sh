#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log_phase() {
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*"
}

cd "$REPO_ROOT"

log_phase "phase 1/4: update repository"
# Syncthing can deliver a file untracked before git learns it's tracked upstream.
# Remove ONLY files git names as blocking AND whose bytes already match upstream.
pull_out=$(git pull --rebase 2>&1) || {
  echo "$pull_out" | awk '/would be overwritten by merge/{grab=1; next} /^Please/{grab=0} grab{sub(/^\t/,""); print}' \
    | while IFS= read -r f; do
        [ -n "$f" ] && git cat-file -e "@{u}:$f" 2>/dev/null \
          && git show "@{u}:$f" | cmp -s - "$f" \
          && rm -f -- "$f" && echo "resolved identical collision: $f"
      done || true
  git pull --rebase || echo "WARN: git pull failed (non-fatal, code update skipped)"
}
git ls-files -z -- data reports interview-prep jds output/upload \
  | xargs -0 -r git update-index --skip-worktree -- 2>/dev/null || true

log_phase "phase 2/4: scan configured portals"
node scan.mjs

# Data transport is Syncthing (see docs/superpowers/specs/2026-08-10-hub-dashboard-design.md §5).
# The Mac owns git history for data paths; this host must not commit or push them.
echo "Data sync is delegated to Syncthing."

if [[ -n "${KUMA_SCAN_PUSH_URL:-}" ]]; then
  curl -fsS "$KUMA_SCAN_PUSH_URL?status=up&msg=daily-scan-complete" >/dev/null \
    || log_phase "warning: scan heartbeat failed"
fi

log_phase "daily scan complete"
