#!/bin/bash
set -euo pipefail

# Run this script on the Proxmox VE host.
CTID=114
TEMPLATE='local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst'

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run this script as root on the Proxmox host." >&2
  exit 1
fi
if ! command -v pct >/dev/null 2>&1; then
  echo "ERROR: pct is not available; run this on the Proxmox host." >&2
  exit 1
fi
if pct status "$CTID" >/dev/null 2>&1; then
  echo "ERROR: container $CTID already exists; refusing to modify it." >&2
  exit 1
fi

echo "Creating and starting Debian 12 container $CTID..."
pct create 114 "$TEMPLATE" \
  --hostname career-ops \
  --unprivileged 1 \
  --cores 2 \
  --memory 4096 \
  --swap 512 \
  --rootfs vm_zfs:20 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp,type=veth \
  --features nesting=1 \
  --onboot 1 \
  --start 1

echo "Waiting for the container network lease..."
LEASED_IP=''
for _attempt in $(seq 1 60); do
  LEASED_IP="$(pct exec 114 -- hostname -I 2>/dev/null | awk '{$1=$1; print}' || true)"
  if [[ -n "$LEASED_IP" ]]; then
    break
  fi
  sleep 2
done

if [[ -z "$LEASED_IP" ]]; then
  echo "ERROR: container 114 started, but no leased IP appeared within 120 seconds." >&2
  exit 1
fi

echo "Container 114 is running. Leased IP address(es): $LEASED_IP"
