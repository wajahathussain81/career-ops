# Self-hosted headless deployment

This kit runs the Career Ops scanner and offline Codex evaluation workers
unattended in a Debian 12 LXC. The scanner runs at 06:41 and the evaluator at
07:13. Both schedules use the LXC's local timezone.

> **PII warning:** this repository contains a CV, profile, application history,
> and other personally identifiable information. Never add a public Git remote,
> mirror it to a public forge, or make the TrueNAS bare repository public.

## Architecture

```text
Laptop working copy <---- SSH push/pull ----> TrueNAS bare Git repository
                                                 ^
                                                 |
                                            SSH pull/push
                                                 |
                                      Debian 12 career-ops LXC
                                      systemd timers + Codex CLI
```

The TrueNAS bare repository is the private synchronization point. The LXC pulls
before each run and pushes scanner/evaluation results afterward. Avoid editing
the same files on the laptop while an automated run is active.

## Install order

1. On the Proxmox VE 8.4 host, run as root:

   ```bash
   bash batch/headless/provision-lxc.sh
   ```

2. Copy `bootstrap-container.sh` into container 114, enter the container, and
   run it as root:

   ```bash
   pct push 114 batch/headless/bootstrap-container.sh /root/bootstrap-container.sh
   pct enter 114
   bash /root/bootstrap-container.sh
   ```

3. Copy the prominently printed Ed25519 public key into the
   `<your-nas-user>@<your-server-ip>` account's `authorized_keys`. If the first clone
   failed, run the retry command printed by the bootstrap script and rerun the
   bootstrap.

4. Authenticate Codex interactively as the service user:

   ```bash
   sudo -iu careerops
   codex login
   exit
   ```

5. Review `/home/careerops/career-ops-env`. Add private Uptime Kuma push URLs if
   desired, then run a smoke test:

   ```bash
   systemctl start career-scan.service
   journalctl -u career-scan.service -n 100 --no-pager
   ```

The bootstrap enables both timers but does not start either service. Enabled
timers become active on the next boot; start them immediately after the smoke
test with:

```bash
systemctl start career-scan.timer career-eval.timer
systemctl list-timers 'career-*'
```

## Operations

Pause automation without disabling its boot configuration:

```bash
systemctl stop career-scan.timer career-eval.timer
```

Resume it:

```bash
systemctl start career-scan.timer career-eval.timer
```

To keep the timers off across reboots, use `systemctl disable --now` for both
timers. Re-enable them with `systemctl enable --now career-scan.timer
career-eval.timer`.

Logs live in the systemd journal:

```bash
journalctl -u career-eval.service
journalctl -u career-scan.service
journalctl -u career-eval.service -f
```

Per-worker Codex logs, last messages, liveness output, prompts, and the current
manifest live in `batch/headless/.headless-work/`. Override that directory with
`CAREER_OPS_WORKDIR` in `career-ops-env` if needed.

To rotate an expired or revoked Codex login:

```bash
sudo -iu careerops
codex logout
codex login
exit
systemctl start career-eval.service
```

The evaluator deliberately treats worker failures as missing results: successful
workers are finalized, failed URLs remain pending for the next run, and all
claimed report-number sentinels are released. `verify-pipeline.mjs` must exit
successfully before any nightly result is committed and pushed.
