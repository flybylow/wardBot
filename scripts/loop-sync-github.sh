#!/usr/bin/env bash
# Push wardBot to GitHub every 3 minutes.
set -euo pipefail

INTERVAL_SEC="${WARD_BOT_SYNC_INTERVAL_SEC:-180}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "loop-sync-github: every ${INTERVAL_SEC}s → https://github.com/flybylow/wardBot"

while true; do
  sleep "$INTERVAL_SEC"
  echo "AGENT_LOOP_TICK_wardbot {\"action\":\"sync-github\"}"
  "$SCRIPT_DIR/sync-github.sh" || echo "loop-sync-github: sync failed (will retry)"
done
