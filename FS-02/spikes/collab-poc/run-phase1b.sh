#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="${LOG_FILE:-phase1b-run.log}"
exec > >(tee "$LOG_FILE") 2>&1

echo "=== CoNote Phase 1b collaboration spike ==="
echo "Working directory: $SCRIPT_DIR"
echo "Output log: $LOG_FILE"

NODE_VERSION="$(node --version)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [[ "$NODE_MAJOR" != "24" ]]; then
  echo "ERROR: Node.js 24.x is required; found $NODE_VERSION"
  exit 1
fi

PNPM_VERSION="$(pnpm --version)"
if [[ "$PNPM_VERSION" != "12.18.0" ]]; then
  echo "ERROR: pnpm 12.18.0 is required; found $PNPM_VERSION"
  exit 1
fi

if ! docker inspect -f '{{.State.Running}}' conote-collab-poc-redis 2>/dev/null | grep -qx true; then
  echo "ERROR: isolated Redis container conote-collab-poc-redis is not running."
  echo "Start it with:"
  echo 'docker run -d --name conote-collab-poc-redis --restart no -p 127.0.0.1:6380:6379 redis:7-alpine redis-server --save "" --appendonly no'
  exit 1
fi

echo
echo "=== Install isolated spike dependencies ==="
pnpm install --frozen-lockfile

echo
echo "=== Verify throwaway PostgreSQL and isolated Redis ==="
pnpm run spike:check

echo
echo "=== TypeScript typecheck ==="
pnpm run typecheck

echo
echo "=== TypeScript build ==="
pnpm run build

echo
echo "=== Execute S1-S11 ==="
pnpm run spike

echo
echo "=== Phase 1b runner finished ==="
echo "Review $LOG_FILE and docs/spikes/phase-1-collab-spike.md before treating any result as accepted."
