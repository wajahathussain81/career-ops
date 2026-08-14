#!/bin/bash
set -euo pipefail

# Run this script inside the Debian 12 LXC as root.
CAREER_USER='careerops'
CAREER_HOME='/home/careerops'
REPO_DIR='/home/careerops/career-ops'
ENV_FILE='/home/careerops/career-ops-env'
NAS_HOST="${NAS_HOST:-192.0.2.10}"
NAS_USER="${NAS_USER:-truenas_admin}"
CLONE_FAILED=0

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run this script as root inside the LXC." >&2
  exit 1
fi

echo "Installing base packages..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates git sudo

echo "Installing Node.js 24 from NodeSource..."
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs

echo "Installing the Codex CLI..."
npm install -g @openai/codex

if ! id "$CAREER_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos '' "$CAREER_USER"
fi

install -d -m 700 -o "$CAREER_USER" -g "$CAREER_USER" "$CAREER_HOME/.ssh"
if [[ ! -f "$CAREER_HOME/.ssh/id_ed25519" ]]; then
  sudo -u "$CAREER_USER" ssh-keygen -q -t ed25519 -N '' \
    -f "$CAREER_HOME/.ssh/id_ed25519" -C 'careerops-lxc'
fi

if [[ ! -f "$CAREER_HOME/.ssh/config" ]] || ! grep -q '^Host truenas-repo$' "$CAREER_HOME/.ssh/config"; then
  # Set NAS_HOST and NAS_USER to your own repository server before running.
  cat >> "$CAREER_HOME/.ssh/config" <<SSH_CONFIG
Host truenas-repo
    HostName $NAS_HOST
    User $NAS_USER
    StrictHostKeyChecking accept-new
SSH_CONFIG
fi
chown "$CAREER_USER:$CAREER_USER" "$CAREER_HOME/.ssh/config"
chmod 600 "$CAREER_HOME/.ssh/config"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'ENV_CONFIG'
# Optional Uptime Kuma push monitors:
# KUMA_PUSH_URL=
# KUMA_SCAN_PUSH_URL=
CODEX_MODEL=gpt-5.6-sol
WAVE_SIZE=4
ENV_CONFIG
fi
chown "$CAREER_USER:$CAREER_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo
echo "======================================================================"
echo "AUTHORIZE THIS SSH PUBLIC KEY ON $NAS_USER@$NAS_HOST:"
cat "$CAREER_HOME/.ssh/id_ed25519.pub"
echo
echo "Add it to the $NAS_USER account's authorized_keys before cloning."
echo "======================================================================"
echo

if [[ ! -d "$REPO_DIR/.git" ]]; then
  if [[ -e "$REPO_DIR" ]]; then
    echo "ERROR: $REPO_DIR exists but is not a Git checkout; move it aside and rerun." >&2
    CLONE_FAILED=1
  elif ! sudo -u "$CAREER_USER" -H git clone \
    truenas-repo:/mnt/Data/repos/career-ops.git "$REPO_DIR"; then
    CLONE_FAILED=1
    echo
    echo "Clone did not succeed. This is expected until TrueNAS authorizes the key."
    echo "After authorization, retry with:"
    echo "  sudo -u $CAREER_USER -H git clone truenas-repo:/mnt/Data/repos/career-ops.git $REPO_DIR"
    echo "Then rerun this bootstrap script to finish dependencies and systemd setup."
  fi
fi

if [[ "$CLONE_FAILED" -eq 0 && -d "$REPO_DIR/.git" ]]; then
  echo "Installing repository npm dependencies as $CAREER_USER..."
  sudo -u "$CAREER_USER" -H bash -lc "cd '$REPO_DIR' && npm install"

  echo "Installing Playwright Chromium system dependencies as root..."
  (
    cd "$REPO_DIR"
    npx playwright install-deps chromium
  )

  echo "Installing the Playwright Chromium browser as $CAREER_USER..."
  sudo -u "$CAREER_USER" -H bash -lc "cd '$REPO_DIR' && npx playwright install chromium"

  echo "Installing and enabling systemd timers..."
  install -m 644 "$REPO_DIR"/batch/headless/systemd/career-scan.service /etc/systemd/system/
  install -m 644 "$REPO_DIR"/batch/headless/systemd/career-scan.timer /etc/systemd/system/
  install -m 644 "$REPO_DIR"/batch/headless/systemd/career-eval.service /etc/systemd/system/
  install -m 644 "$REPO_DIR"/batch/headless/systemd/career-eval.timer /etc/systemd/system/

  systemctl daemon-reload
  systemctl enable career-scan.timer career-eval.timer
fi

echo
echo "Bootstrap TODO checklist"
echo "  1. Authorize the SSH public key shown above for truenas_admin on TrueNAS."
if [[ "$CLONE_FAILED" -eq 1 ]]; then
  echo "  2. Re-run the clone command shown above, then rerun this bootstrap script."
else
  echo "  2. Clone completed; no retry is needed."
fi
echo "  3. Start an interactive shell with: sudo -iu $CAREER_USER"
echo "     Then authenticate Codex with: codex login"
echo "  4. Smoke-test once with: systemctl start career-scan.service"
echo "     Inspect it with: journalctl -u career-scan.service -n 100 --no-pager"
