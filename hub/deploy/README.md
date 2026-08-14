# career-ops Hub Deployment Runbook

This runbook deploys the hub on LXC 114 and uses Syncthing for the five live data paths. Git remains the code-update path only.

## 1. Prepare the NAS

On `<your-nas-host>` (TrueNAS SCALE 24.10 at `<your-server-ip>`):

1. In **Apps**, **Shares**, and **Datasets**, confirm that nothing named `<potentially-conflicting-service>` uses `/mnt/Data/career-ops` or the proposed Syncthing paths. The dedicated dataset keeps this deployment isolated.
2. In **Datasets**, create the dedicated child dataset `Data/career-ops`. Give a dedicated Syncthing user/group ownership and read/write access; do not grant other NAS services access.
3. Open the TrueNAS shell and create the Syncthing targets:

   ```sh
   sudo mkdir -p /mnt/Data/career-ops/sync/{data,reports,interview-prep,jds,resumes} /mnt/Data/career-ops/config
   ```

   Apply the dedicated Syncthing user/group ownership to `/mnt/Data/career-ops` in the dataset permissions UI. The resulting layout must be:

   ```text
   /mnt/Data/career-ops/
     sync/data/
     sync/reports/
     sync/interview-prep/
     sync/jds/
     sync/resumes/
     config/
   ```

4. In **Apps → Discover Apps**, install the Syncthing catalog app. Configure its persistent app state at `/mnt/Data/career-ops/config`, mount `/mnt/Data/career-ops/sync` into the app at `/sync`, and run it with the dedicated dataset user's UID/GID. In Syncthing, the five NAS folder paths will be `/sync/data`, `/sync/reports`, `/sync/interview-prep`, `/sync/jds`, and `/sync/resumes`.
5. In **Data Protection → Periodic Snapshot Tasks**, add both recursive snapshot tasks for `Data/career-ops`:

   - Quarter-hour task: schedule `*/15 * * * *`; lifetime `1 day` (keeps 24 hours of quarter-hour snapshots).
   - Daily task: schedule `0 0 * * *`; lifetime `30 days` (keeps 30 daily snapshots).

## 2. Configure Syncthing on the Mac and LXC 114

1. Install and start Syncthing on the Mac:

   ```sh
   brew install syncthing
   brew services start syncthing
   syncthing --device-id
   ```

   Its local UI is at `http://127.0.0.1:8384`.

2. Install and start Syncthing on LXC 114 as the `career` user:

   ```sh
   sudo apt update
   sudo apt install -y syncthing
   sudo systemctl enable --now syncthing@career.service
   sudo -iu career -- syncthing --device-id
   ```

   If remote UI access is needed, keep the Syncthing GUI bound to loopback and tunnel it from the Mac:

   ```sh
   ssh -L 8385:127.0.0.1:8384 career@<lxc-ip>
   ```

   Then open `http://127.0.0.1:8385` on the Mac.

3. In the NAS Syncthing UI, use **Actions → Show ID** to record the NAS device ID. Add the Mac and LXC device IDs to the NAS. On both the Mac and LXC, add the NAS device ID and enable **Introducer** for that NAS remote device. Accept the introduced devices so the NAS remains the always-on hub even when the Mac and LXC are not online together.
4. Create and share five **Send & Receive** folders. Use the same folder ID on all three devices and these paths:

   | Folder ID | Mac checkout | LXC 114 | NAS app path (host path) |
   |---|---|---|---|
   | `career-ops-data` | `<repo-root>/data` | `/opt/career-ops/data` | `/sync/data` (`/mnt/Data/career-ops/sync/data`) |
   | `career-ops-reports` | `<repo-root>/reports` | `/opt/career-ops/reports` | `/sync/reports` (`/mnt/Data/career-ops/sync/reports`) |
   | `career-ops-interview-prep` | `<repo-root>/interview-prep` | `/opt/career-ops/interview-prep` | `/sync/interview-prep` (`/mnt/Data/career-ops/sync/interview-prep`) |
   | `career-ops-jds` | `<repo-root>/jds` | `/opt/career-ops/jds` | `/sync/jds` (`/mnt/Data/career-ops/sync/jds`) |
   | `career-ops-resumes` | `<repo-root>/output/upload` | `/opt/career-ops/output/upload` | `/sync/resumes` (`/mnt/Data/career-ops/sync/resumes`) |

5. For every folder on every device, open **Edit → Ignore Patterns** and paste the complete contents of `hub/deploy/stignore-data.txt`:

   ```text
   *.lock
   (?d).DS_Store
   cache
   applications.db
   parser-output
   *.sync-conflict*
   ```

6. Wait until all five folders report **Up to Date** on the NAS, Mac, and LXC. Normal LAN changes should become visible on the other nodes in about 1–2 seconds.

## 3. Prepare and start LXC 114

Run these commands on LXC 114. The checkout must be `/opt/career-ops`, owned and operated by the `career` user.

1. Verify Node.js 20 or newer:

   ```sh
   /usr/bin/node --version
   /usr/bin/node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 20) { console.error("Node >= 20 required"); process.exit(1) }'
   ```

2. Install the Codex and Claude CLIs, authenticate both as `career`, and verify headless execution:

   ```sh
   sudo npm install --global @openai/codex @anthropic-ai/claude-code
   sudo -iu career -- codex login
   sudo -iu career -- claude
   sudo -iu career -- codex exec "reply OK"
   sudo -iu career -- claude -p "reply OK"
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

4. Install the systemd unit and environment file. Replace `change-me` in `/etc/career-ops/hub.env` with a strong secret before starting the service:

   ```sh
   cd /opt/career-ops
   sudo install -d -m 0750 /etc/career-ops
   sudo cp hub/deploy/hub.service /etc/systemd/system/hub.service
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

- [ ] **SSE liveness:** keep a hub page open, edit and save a synced file such as `data/applications.md` on the Mac, and confirm the page updates without a manual reload within about 1–2 seconds. Revert the test edit.
- [ ] **Chat end-to-end:** open `/chat`, ask the selected agent to `reply OK`, and confirm the response streams through to completion without an authentication prompt or service error.
- [ ] **Conflict banner:** on LXC 114, forge a conflict file, confirm the hub shows the persistent red conflict banner naming it, then remove only that test file:

  ```sh
  cd /opt/career-ops
  touch data/hub-smoke.sync-conflict-test
  rm data/hub-smoke.sync-conflict-test
  ```

- [ ] **Status round-trip:** record an application's current status, change it with the hub status dropdown, and confirm the matching row in the Mac checkout's `data/applications.md` changes within seconds. Restore the original status with the dropdown and confirm that restoration reaches the Mac too.

## 5. Never sync Git internals

> [!WARNING]
> **`.git/` must NEVER be inside any Syncthing folder.** Bidirectional Syncthing replication can corrupt Git internals on every peer. Share only the five explicit data folders above; never share `/opt/career-ops`, the Mac repository root, or any parent directory containing `.git/`.
