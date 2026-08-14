#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export CAREER_OPS_WORKDIR="${CAREER_OPS_WORKDIR:-$REPO_ROOT/batch/headless/.headless-work}"
PENDING_FILE="$CAREER_OPS_WORKDIR/pending-urls.txt"
LIVE_FILE="$CAREER_OPS_WORKDIR/live-urls.txt"
EXPIRED_FILE="$CAREER_OPS_WORKDIR/expired-urls.txt"
LIVENESS_LOG="$CAREER_OPS_WORKDIR/liveness.log"
declare -a RESERVED_RANGES=()
RESERVATIONS_ACTIVE=0

log_phase() {
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*"
}

release_reservations_on_failure() {
  if (( RESERVATIONS_ACTIVE == 0 )); then
    return
  fi
  log_phase "cleanup: releasing report-number reservations"
  for range in "${RESERVED_RANGES[@]}"; do
    node reserve-report-num.mjs --release "$range" >/dev/null 2>&1 || true
  done
}
trap release_reservations_on_failure EXIT

mkdir -p "$CAREER_OPS_WORKDIR"
cd "$REPO_ROOT"

log_phase "phase 1/10: update repository"
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

log_phase "phase 2/10: collect pending pipeline URLs"
awk '/^- \[ \] / { line = $0; sub(/^- \[ \] /, "", line); split(line, fields, / \| /); print fields[1] }' \
  data/pipeline.md > "$PENDING_FILE"
PENDING_COUNT="$(awk 'NF { count++ } END { print count + 0 }' "$PENDING_FILE")"
if (( PENDING_COUNT == 0 )); then
  log_phase "nothing to do"
  exit 0
fi

log_phase "phase 3/10: liveness sweep for $PENDING_COUNT URL(s)"
set +e
node check-liveness.mjs --file "$PENDING_FILE" --throttle | tee "$LIVENESS_LOG"
LIVENESS_STATUS=${PIPESTATUS[0]}
set -e
if (( LIVENESS_STATUS > 1 )); then
  echo "ERROR: liveness checker failed with exit $LIVENESS_STATUS" >&2
  exit "$LIVENESS_STATUS"
fi
{ grep -E '^(✅ active|⚠️ uncertain)' "$LIVENESS_LOG" || true; } | awk '{ print $NF }' > "$LIVE_FILE"
{ grep -E '^❌ expired' "$LIVENESS_LOG" || true; } | awk '{ print $NF }' > "$EXPIRED_FILE"
LIVE_COUNT="$(awk 'NF { count++ } END { print count + 0 }' "$LIVE_FILE")"
EXPIRED_COUNT="$(awk 'NF { count++ } END { print count + 0 }' "$EXPIRED_FILE")"
if (( LIVE_COUNT + EXPIRED_COUNT != PENDING_COUNT )); then
  echo "ERROR: liveness sweep produced verdicts for $((LIVE_COUNT + EXPIRED_COUNT)) of $PENDING_COUNT URLs" >&2
  exit 1
fi

log_phase "phase 4/10: reserve report numbers for $LIVE_COUNT live/uncertain URL(s)"
START_NUM=1
if (( LIVE_COUNT > 0 )); then
  remaining=$LIVE_COUNT
  expected_start=0
  while (( remaining > 0 )); do
    chunk=$remaining
    if (( chunk > 50 )); then
      chunk=50
    fi
    reservation="$(node reserve-report-num.mjs --count "$chunk")"
    if [[ ! "$reservation" =~ ^([0-9]+)(-([0-9]+))?$ ]]; then
      echo "ERROR: unexpected reservation output: $reservation" >&2
      exit 1
    fi
    range_start=$((10#${BASH_REMATCH[1]}))
    range_end=$range_start
    if [[ -n "${BASH_REMATCH[3]:-}" ]]; then
      range_end=$((10#${BASH_REMATCH[3]}))
    fi
    RESERVED_RANGES+=("$reservation")
    RESERVATIONS_ACTIVE=1
    if (( expected_start != 0 && range_start != expected_start )); then
      echo "ERROR: report reservations are not contiguous ($expected_start expected, got $range_start)" >&2
      exit 1
    fi
    if (( ${#RESERVED_RANGES[@]} == 1 )); then
      START_NUM=$range_start
    fi
    expected_start=$((range_end + 1))
    remaining=$((remaining - chunk))
  done
fi

log_phase "phase 5/10: fetch JDs and prepare worker prompts"
node batch/headless/prepare-batch.mjs "$LIVE_FILE" "$START_NUM"

log_phase "phase 6/10: run Codex evaluation waves"
bash batch/headless/run-waves.sh

log_phase "phase 7/10: finalize batch and pipeline entries"
FINALIZE_JSON="$(node batch/headless/finalize-batch.mjs)"
RESERVATIONS_ACTIVE=0
echo "$FINALIZE_JSON"
EVALUATED="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(String(value.evaluated));' "$FINALIZE_JSON")"
SKIPPED="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(String(value.skipped));' "$FINALIZE_JSON")"

log_phase "phase 8/10: merge tracker additions"
node merge-tracker.mjs

log_phase "phase 9/10: verify pipeline integrity"
node verify-pipeline.mjs

# Data transport is Syncthing (see docs/superpowers/specs/2026-08-10-hub-dashboard-design.md §5).
# The Mac owns git history for data paths; this host must not commit or push them.
echo "Data sync is delegated to Syncthing."

if [[ -n "${KUMA_PUSH_URL:-}" ]]; then
  curl -fsS "$KUMA_PUSH_URL?status=up&msg=${EVALUATED}-eval-${SKIPPED}-skip" >/dev/null \
    || log_phase "warning: evaluation heartbeat failed"
fi

log_phase "nightly evaluation complete: $EVALUATED evaluated, $SKIPPED skipped, $EXPIRED_COUNT expired"
