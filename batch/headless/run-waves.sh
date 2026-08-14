#!/bin/bash
set -euo pipefail

# Run Codex evaluation workers in bounded waves.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKDIR="${CAREER_OPS_WORKDIR:-$REPO_ROOT/batch/headless/.headless-work}"
MANIFEST="$WORKDIR/batch-manifest.json"
CHUNK="${WAVE_SIZE:-6}"
MODEL="${CODEX_MODEL:-gpt-5.6-sol}"

if [[ ! "$CHUNK" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: WAVE_SIZE must be a positive integer." >&2
  exit 1
fi
if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: manifest not found: $MANIFEST" >&2
  exit 1
fi

cd "$REPO_ROOT"
mapfile -t NUMS < <(
  node -e 'const fs = require("fs"); const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); manifest.filter(x => x.status === "ready").forEach(x => console.log(x.num));' "$MANIFEST"
)
echo "workers to run: ${#NUMS[@]}"

i=0
while (( i < ${#NUMS[@]} )); do
  batch=("${NUMS[@]:i:CHUNK}")
  echo "=== wave starting: ${batch[*]} ==="
  for n in "${batch[@]}"; do
    (
      set +e
      codex exec --model "$MODEL" --sandbox workspace-write --skip-git-repo-check \
        --output-last-message "$WORKDIR/out-$n.txt" \
        "$(cat "$WORKDIR/prompt-$n.md")" > "$WORKDIR/codex-log-$n.txt" 2>&1
      status=$?
      echo "EXIT=$status worker=$n"
      exit 0
    ) &
  done
  wait
  i=$((i + CHUNK))
done

echo '=== ALL CODEX WORKERS DONE ==='
for n in "${NUMS[@]}"; do
  printf -- '--- %s ---\n' "$n"
  cat "$WORKDIR/out-$n.txt" 2>/dev/null || echo "(no output)"
  echo
done
