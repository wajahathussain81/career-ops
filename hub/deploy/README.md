# Hub deployment

The hub can run as a long-lived systemd service on a small container or VM.
The supplied `deploy.sh` keeps application code current without treating
career data as part of the deployment.

## What the script does

1. Fetches the configured remote and resets the checkout to the selected branch.
2. Checks out code paths only, leaving synchronized data directories untouched.
3. Restores tracked files that are missing from synchronized directories without
   overwriting files already supplied by the sync service.
4. Re-arms Git's `skip-worktree` flags for synchronized paths.
5. Restarts the systemd service and performs an HTTP health check.

## Prerequisites

- A container or VM with Node.js 18 or newer and a career-ops checkout.
- Key-based SSH access through a host alias such as `pve-host`.
- A systemd unit installed from `hub/deploy/hub.service`.
- An environment file based on `hub/deploy/hub.env.example`, with a strong
  `HUB_TOKEN` and the correct checkout path.
- The deploy script configured for the target host, guest identifier, and branch.

Run the deploy command from the repository root:

```bash
bash hub/deploy/deploy.sh
```

## Data synchronization

The `data/`, `interview-prep/`, and `reports/` directories are expected to
be synchronized separately, for example with Syncthing. They are not refreshed
from Git during deployment. This keeps the hub on the same live career data as
the rest of career-ops while code updates remain predictable.
