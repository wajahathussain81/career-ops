# career-ops Hub Deployment Runbook

The Syncthing/NAS setup in this runbook is entirely optional. For single-machine use, no sync or NAS is needed: from the repository root, run `HUB_TOKEN=<token> node hub/server.mjs`.

The optional topology below deploys the hub on your always-on Linux host (LXC, VM, or spare machine) and uses Syncthing for the five live data paths. Git remains the code-update path only.

## 1. Prepare the NAS (optional)

On `<your-nas>` (reachable at `<nas-ip>`):

1. In your NAS administration interface, confirm that no existing app, share, or dataset uses the proposed Syncthing paths. A dedicated dataset keeps this deployment isolated.
2. Create the dedicated dataset `<pool>/career-ops`. Give a dedicated Syncthing user/group ownership and read/write access; do not grant other NAS services access.
3. Open the NAS shell and create the Syncthing targets:

   ```sh
   sudo mkdir -p /mnt/<pool>/career-ops/sync/{data,reports,interview-prep,jds,resumes} /mnt/<pool>/career-ops/config
   ```

   Apply the dedicated Syncthing user/group ownership to `/mnt/<pool>/career-ops` in the dataset permissions UI. The resulting layout must be:

   ```text
   /mnt/<pool>/career-ops/
     sync/data/
     sync/reports/
     sync/interview-prep/
     sync/jds/
     sync/resumes/
     config/
   ```

4. Install Syncthing using your NAS app manager. Configure its persistent app state at `/mnt/<pool>/career-ops/config`, mount `/mnt/<pool>/career-ops/sync` into the app at `/sync`, and run it with the dedicated dataset user's UID/GID. In Syncthing, the five NAS folder paths will be `/sync/data`, `/sync/reports`, `/sync/interview-prep`, `/sync/jds`, and `/sync/resumes`.
5. In your NAS snapshot settings, add both recursive snapshot tasks for `<pool>/career-ops`:

   - Quarter-hour task: schedule `*/15 * * * *`; lifetime `1 day` (keeps 24 hours of quarter-hour snapshots).
   - Daily task: schedule `0 0 * * *`; lifetime `30 days` (keeps 30 daily snapshots).

## 2. Configure Syncthing on your workstation and Linux host (optional)

1. Install and start Syncthing on your workstation. For example, on macOS:

   ```sh
   brew install syncthing
   brew services start syncthing
   syncthing --device-id
   ```

   Its local UI is at `http://127.0.0.1:8384`.

2. Install and start Syncthing on your always-on Linux host (LXC, VM, or spare machine) as `<service-user>`:

   ```sh
   sudo apt update
   sudo apt install -y syncthing
   sudo systemctl enable --now syncthing@<service-user>.service
   sudo -iu <service-user> -- syncthing --device-id
   ```

   If remote UI access is needed, keep the Syncthing GUI bound to loopback and tunnel it from your workstation:

   ```sh
   ssh -L 8385:127.0.0.1:8384 <service-user>@<lxc-ip>
   ```

   Then open `http://127.0.0.1:8385` on your workstation.

3. In the NAS Syncthing UI, use **Actions → Show ID** to record the NAS device ID. Add the workstation and Linux-host device IDs to the NAS. On both the workstation and Linux host, add the NAS device ID and enable **Introducer** for that NAS remote device. Accept the introduced devices so the NAS remains the always-on sync peer even when the other devices are not online together.
4. Create and share five **Send & Receive** folders. Use the same folder ID on all three devices and these paths:

   | Folder ID | Workstation checkout | Linux host | NAS app path (host path) |
   |---|---|---|---|
   | `career-ops-data` | `<repo-root>/data` | `/opt/career-ops/data` | `/sync/data` (`/mnt/<pool>/career-ops/sync/data`) |
   | `career-ops-reports` | `<repo-root>/reports` | `/opt/career-ops/reports` | `/sync/reports` (`/mnt/<pool>/career-ops/sync/reports`) |
   | `career-ops-interview-prep` | `<repo-root>/interview-prep` | `/opt/career-ops/interview-prep` | `/sync/interview-prep` (`/mnt/<pool>/career-ops/sync/interview-prep`) |
   | `career-ops-jds` | `<repo-root>/jds` | `/opt/career-ops/jds` | `/sync/jds` (`/mnt/<pool>/career-ops/sync/jds`) |
   | `career-ops-resumes` | `<repo-root>/output/upload` | `/opt/career-ops/output/upload` | `/sync/resumes` (`/mnt/<pool>/career-ops/sync/resumes`) |

5. For every folder on every device, open **Edit → Ignore Patterns** and paste the complete contents of `hub/deploy/stignore-data.txt`:

   ```text
   *.lock
   (?d).DS_Store
   cache
   applications.db
   parser-output
   *.sync-conflict*
   ```

6. Wait until all five folders report **Up to Date** on the NAS, workstation, and Linux host. Normal LAN changes should become visible on the other nodes in about 1–2 seconds.

## 3. Prepare and start the Linux host

Run these commands on your always-on Linux host (LXC, VM, or spare machine). The checkout must be `/opt/career-ops`, owned and operated by `<service-user>`.

1. Verify Node.js 20 or newer:

   ```sh
   /usr/bin/node --version
   /usr/bin/node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 20) { console.error("Node >= 20 required"); process.exit(1) }'
   ```

2. Install the Codex and Claude CLIs, authenticate both as `<service-user>`, and verify headless execution:

   ```sh
   sudo npm install --global @openai/codex @anthropic-ai/claude-code
   sudo -iu <service-user> -- codex login
   sudo -iu <service-user> -- claude
   sudo -iu <service-user> -- codex exec "reply OK"
   sudo -iu <service-user> -- claude -p "reply OK"
   ```

   Complete each interactive login before running its verification command. Each verification must print an `OK` reply without requesting authentication.

3. Keep the five Syncthing-owned paths out of Git's local update path. This marks every currently tracked file under those paths as `skip-worktree`:

   ```sh
   cd /opt/career-ops
   git ls-files -z -- data reports interview-prep jds output/upload \
     | xargs -0 -r git update-index --skip-worktree --
   git ls-files -v -- data reports interview-prep jds output/upload \
     | awk '$1 ~ /^S/ { print }'
   ```

4. Install the systemd unit and environment file. First copy `hub.service` to a temporary location, replace the commented `User=<service-user>` placeholder with an active `User=` line for your service account, and replace `change-me` in `/etc/career-ops/hub.env` with a strong secret before starting the service:

   ```sh
   cd /opt/career-ops
   sudo install -d -m 0750 /etc/career-ops
   cp hub/deploy/hub.service /tmp/hub.service
   sudoedit /tmp/hub.service
   sudo install -m 0644 /tmp/hub.service /etc/systemd/system/hub.service
   sudo cp hub/deploy/hub.env.example /etc/career-ops/hub.env
   sudo chmod 0600 /etc/career-ops/hub.env
   sudoedit /etc/career-ops/hub.env
   sudo systemctl daemon-reload
   sudo systemctl enable --now hub
   sudo systemctl status hub.service --no-pager
   ```

5. From a LAN device, open `http://<lxc-ip>:8484` and log in with `HUB_TOKEN`.

## 4. Run the manual smoke checklist

Complete every check before relying on the hub:

- [ ] **SSE liveness:** keep a hub page open, edit and save a synced file such as `data/applications.md` on your workstation, and confirm the page updates without a manual reload within about 1–2 seconds. Revert the test edit.
- [ ] **Chat end-to-end:** open `/chat`, ask the selected agent to `reply OK`, and confirm the response streams through to completion without an authentication prompt or service error.
- [ ] **Conflict banner:** on the Linux host, forge a conflict file, confirm the hub shows the persistent red conflict banner naming it, then remove only that test file:

  ```sh
  cd /opt/career-ops
  touch data/hub-smoke.sync-conflict-test
  rm data/hub-smoke.sync-conflict-test
  ```

- [ ] **Status round-trip:** record an application's current status, change it with the hub status dropdown, and confirm the matching row in the workstation checkout's `data/applications.md` changes within seconds. Restore the original status with the dropdown and confirm that restoration reaches the workstation too.

## 5. Never sync Git internals

> [!WARNING]
> **`.git/` must NEVER be inside any Syncthing folder.** Bidirectional Syncthing replication can corrupt Git internals on every peer. Share only the five explicit data folders above; never share `/opt/career-ops`, the workstation repository root, or any parent directory containing `.git/`.
