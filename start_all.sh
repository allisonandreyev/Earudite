#!/usr/bin/env bash
# Starts all five Earudite services in the background with nohup, matching README.md.
# Usage: ./start_all.sh
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Locate the 'earudite' conda env. It has lived under both miniconda and anaconda3, so probe the
# known locations (and $CONDA_PREFIX) instead of hardcoding one — a moved install used to make
# this script fail at line 1 with a misleading "conda env not found".
PY_BIN="${EARUDITE_PY_BIN:-}"
if [ -z "$PY_BIN" ]; then
  for candidate in \
    "/opt/anaconda3/envs/earudite/bin" \
    "/opt/homebrew/Caskroom/miniconda/base/envs/earudite/bin" \
    "$HOME/miniconda3/envs/earudite/bin" \
    "$HOME/anaconda3/envs/earudite/bin"; do
    if [ -x "$candidate/python3.11" ]; then PY_BIN="$candidate"; break; fi
  done
fi

if [ -z "$PY_BIN" ] || [ ! -x "$PY_BIN/python3.11" ]; then
  echo "ERROR: conda env 'earudite' not found. Looked in /opt/anaconda3, /opt/homebrew miniconda," >&2
  echo "       ~/miniconda3 and ~/anaconda3. Set EARUDITE_PY_BIN=/path/to/env/bin to override." >&2
  exit 1
fi
echo "Using python from: $PY_BIN"

if [ ! -f "$ROOT_DIR/.env.local" ]; then
  echo "ERROR: $ROOT_DIR/.env.local not found. Create it with CONNECTION_STRING and FIREBASE_KEY_PATH." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$ROOT_DIR/.env.local"

if [ -z "${CONNECTION_STRING:-}" ] || [[ "$CONNECTION_STRING" == *PASTE_MONGODB* ]]; then
  echo "ERROR: CONNECTION_STRING is not set in .env.local" >&2
  exit 1
fi
if [ -z "${FIREBASE_KEY_PATH:-}" ] || [ ! -f "$FIREBASE_KEY_PATH" ]; then
  echo "ERROR: FIREBASE_KEY_PATH is not set or file does not exist: ${FIREBASE_KEY_PATH:-<unset>}" >&2
  exit 1
fi

check_port_free() {
  local port="$1" name="$2"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "SKIP: $name — port $port is already in use. Run ./stop_all.sh first if you want a clean restart." >&2
    return 1
  fi
  return 0
}

wait_for_port() {
  local port="$1" name="$2" tries=40
  while [ $tries -gt 0 ]; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "OK: $name is listening on port $port"
      return 0
    fi
    sleep 1
    tries=$((tries - 1))
  done
  echo "WARN: $name did not start listening on port $port — check its log" >&2
  return 1
}

echo "=== 1/5 quizzr-server (data flow, :5110) ==="
if check_port_free 5110 "quizzr-server"; then
  ( cd "$ROOT_DIR/quizzr-server" && \
    CONNECTION_STRING="$CONNECTION_STRING" nohup "$PY_BIN/gunicorn" \
      -w 4 -b 0.0.0.0:5110 "server:create_app()" >> /tmp/quizzr_server.log 2>&1 & disown )
  wait_for_port 5110 "quizzr-server"
fi

echo "=== 2/5 hls (audio streaming, :4440) ==="
if check_port_free 4440 "hls"; then
  ( cd "$ROOT_DIR/hls" && \
    CONNECTION_STRING="$CONNECTION_STRING" nohup "$PY_BIN/python3.11" \
      hls_server.py >> /tmp/hls_server.log 2>&1 & disown )
  wait_for_port 4440 "hls"
fi

echo "=== 3/5 quizzr-socket-server (real-time game, :4000) ==="
if check_port_free 4000 "quizzr-socket-server"; then
  ( cd "$ROOT_DIR/quizzr-socket-server" && \
    nohup "$PY_BIN/python3.11" main.py \
      --socketport 4000 \
      --secretpath "$FIREBASE_KEY_PATH" \
      --hlsurl "http://localhost:4440" \
      --backendurl "http://localhost:5110" \
      --whispermodel base >> /tmp/socket_server.log 2>&1 & disown )
  wait_for_port 4000 "quizzr-socket-server"
fi

echo "=== 4/5 server (proxy + frontend host, :6800) ==="
if check_port_free 6800 "server"; then
  ( cd "$ROOT_DIR/server" && nohup node server.js >> /tmp/node_server.log 2>&1 & disown )
  wait_for_port 6800 "server"
fi

echo "=== 5/5 browser-asr (frontend dev server, :3000) ==="
if check_port_free 3000 "browser-asr"; then
  ( cd "$ROOT_DIR/browser-asr" && nohup npm start >> /tmp/browser_asr.log 2>&1 & disown )
  wait_for_port 3000 "browser-asr"
fi

echo
echo "Done. Open http://localhost:3000"
echo "Logs: /tmp/quizzr_server.log /tmp/hls_server.log /tmp/socket_server.log /tmp/node_server.log /tmp/browser_asr.log"
