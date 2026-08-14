#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log_phase() {
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*"
}

cd "$REPO_ROOT"

log_phase "phase 1/6: update repository"
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

log_phase "phase 2/6: fetch job-application replies"
fetch_json="$(node batch/headless/fetch-replies.mjs)"
printf '%s\n' "$fetch_json"
fetch_status="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$fetch_json")"
appended="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).appended))' "$fetch_json")"

if [[ "$fetch_status" == "no-credentials" ]]; then
  log_phase "Gmail credentials are not configured; skipping classification"
  exit 0
fi

today="$(date +%F)"
candidates_path="data/reply-candidates.json"
updates_dir="data/email-updates"
updates_path="$updates_dir/$today.md"

log_phase "phase 3/6: classify job-application replies"
mkdir -p "$updates_dir"
if [[ -f "$candidates_path" ]] && { (( appended > 0 )) || [[ -s "$candidates_path" ]]; }; then
  {
    printf '# Email updates %s\n\n' "$today"
    node reply-watch.mjs "$candidates_path"
  } | tee "$updates_path"
else
  printf 'No job-related email in the last 24h.\n' | tee "$updates_path"
fi

log_phase "phase 4/6: queue email-update review"
if [[ ! -f data/agent-inbox.md ]]; then
  printf '# Agent Inbox\n\n' > data/agent-inbox.md
fi
printf -- '- [ ] %s: email check — see %s\n' "$today" "$updates_path" >> data/agent-inbox.md

# Data transport is Syncthing (see docs/superpowers/specs/2026-08-10-hub-dashboard-design.md §5).
# The Mac owns git history for data paths; this host must not commit or push them.
echo "Data sync is delegated to Syncthing."

log_phase "phase 6/6: send optional heartbeat"
if [[ -n "${KUMA_EMAIL_PUSH_URL:-}" ]]; then
  curl -fsS "$KUMA_EMAIL_PUSH_URL?status=up&msg=daily-email-check-complete" >/dev/null \
    || log_phase "warning: email heartbeat failed"
fi

log_phase "daily email check complete"
