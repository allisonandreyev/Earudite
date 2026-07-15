#!/usr/bin/env bash
# Stops all five Earudite services by killing whatever is listening on their ports.
# Usage: ./stop_all.sh
set -uo pipefail

# Parallel arrays instead of an associative array — macOS ships bash 3.2, which lacks `declare -A`.
PORTS=(5110 4440 4000 6800 3000)
NAMES=("quizzr-server" "hls" "quizzr-socket-server" "server" "browser-asr")

for i in "${!PORTS[@]}"; do
  port="${PORTS[$i]}"
  name="${NAMES[$i]}"
  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    echo "  $name (:$port) — not running"
  else
    echo "  $name (:$port) — killing PID(s) $pids"
    kill -9 $pids 2>/dev/null || true
  fi
done

echo "Done."
