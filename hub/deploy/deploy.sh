#!/usr/bin/env bash
# career-ops hub deploy — run from the Mac, drives LXC ${CT_ID} via SSH.
#
#   bash hub/deploy/deploy.sh
#
# Deploys the pushed state of ${BRANCH} into the container checkout and
# restarts the hub. The container's data/, interview-prep/, and reports/
# are OWNED BY SYNCTHING, not git: they carry skip-worktree bits, so a
# plain `git pull` aborts whenever a data commit lands (proven 2026-08-12).
# This script therefore never merges. It:
#   1. stops Syncthing (it races any git operation on those dirs)
#   2. fetches and moves the branch pointer with a mixed reset
#      (touches no working-tree file)
#   3. checks out CODE paths only (everything except the synced dirs)
#   4. restores files missing from the synced dirs (never overwrites
#      existing ones — Syncthing content wins over git content there)
#   5. re-arms skip-worktree on the synced dirs (reset may drop the bits)
#   6. restarts Syncthing + hub and probes the /archive endpoint
#
# Prereqs: set PVE_HOST to your Proxmox SSH host/alias (key auth), branch
# pushed to the NAS remote the container pulls from (`git push homelab`).

set -euo pipefail

PVE_HOST="${PVE_HOST:-your-proxmox-host}"
CT_ID="${CT_ID:-114}"
BRANCH="${BRANCH:-main}"
SYNCED_DIRS="data interview-prep reports"
HUB_URL="http://127.0.0.1:8484/archive"

pve() { ssh -o BatchMode=yes "$PVE_HOST" "$@"; }
ct() { pve "pct exec $CT_ID -- $1"; }
ct_git() { pve "pct exec $CT_ID -- su - careerops -c 'cd ~/career-ops && $1'"; }

SYNCTHING_STOPPED=0
restore_syncthing() {
  if [ "$SYNCTHING_STOPPED" = 1 ]; then
    ct "systemctl start syncthing@careerops.service" || echo "WARN: could not restart syncthing — check the container" >&2
  fi
}
trap restore_syncthing EXIT

echo "==> Local branch vs pushed state"
git -C "$(dirname "$0")/../.." log --oneline -1 "$BRANCH" || true

echo "==> Stopping Syncthing in CT $CT_ID"
ct "systemctl stop syncthing@careerops.service"
SYNCTHING_STOPPED=1

echo "==> Fetch + mixed reset to origin/$BRANCH (no working-tree writes)"
ct_git "git fetch origin && git update-index --refresh -q; git reset origin/$BRANCH >/dev/null && git log --oneline -1"

echo "==> Checking out code paths (synced dirs excluded)"
EXCLUDES=""
for d in $SYNCED_DIRS; do EXCLUDES="$EXCLUDES \":(exclude)$d\""; done
ct_git "git checkout -- . $EXCLUDES"

echo "==> Restoring files missing from synced dirs (existing files untouched)"
ct_git "git ls-files -d -- $SYNCED_DIRS | xargs -r git checkout --"

echo "==> Re-arming skip-worktree on synced dirs"
ct_git "git ls-files -- $SYNCED_DIRS | xargs -r git update-index --skip-worktree"
COUNT=$(ct_git "git ls-files -v -- $SYNCED_DIRS | grep -c ^S")
echo "skip-worktree files: $COUNT"

echo "==> Restarting services"
ct "systemctl start syncthing@careerops.service"
SYNCTHING_STOPPED=0
ct "systemctl restart hub.service"

echo "==> Health check"
ct "systemctl is-active syncthing@careerops.service hub.service"
STATUS=$(pve "pct exec $CT_ID -- su - careerops -c 'curl -s -o /dev/null -w %{http_code} $HUB_URL'")
echo "hub $HUB_URL -> HTTP $STATUS"
case "$STATUS" in
  200|302) echo "==> Deploy OK" ;;
  *) echo "ERROR: hub responded $STATUS" >&2; exit 1 ;;
esac
