#!/usr/bin/env bash
# Builds browser-asr and deploys it to the node host on :6800.
#
# Replaces the manual build/copy/restart sequence. Safe to re-run.
#
# Usage: ./deploy.sh            # build + deploy + restart
#        ./deploy.sh --no-restart   # build + deploy, leave the server alone
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/browser-asr"
SERVER_DIR="$ROOT_DIR/server"
PORT=6800
RESTART=1
[ "${1:-}" = "--no-restart" ] && RESTART=0

fail() { echo "ERROR: $*" >&2; exit 1; }

[ -d "$FRONTEND_DIR" ] || fail "no browser-asr dir at $FRONTEND_DIR"
[ -d "$SERVER_DIR" ] || fail "no server dir at $SERVER_DIR"
[ -d "$FRONTEND_DIR/node_modules" ] || fail "browser-asr/node_modules missing — run 'npm install --legacy-peer-deps' in browser-asr first"

# ---------------------------------------------------------------------------
# 1. Build
#
# The REACT_APP_PUBLIC_* vars are read from browser-asr/.env by react-scripts, but they are
# exported explicitly here too. A past deploy shipped a bundle with all four baked in as empty
# strings, which left urls['dataflow'] undefined and broke auth (axios called "undefined/profile").
# Exporting them makes the build independent of whether .env is picked up, and the verification
# step below turns a recurrence into a failed deploy instead of a silently broken site.
# ---------------------------------------------------------------------------
if [ -f "$FRONTEND_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$FRONTEND_DIR/.env"
  set +a
fi

export REACT_APP_PUBLIC_DATAFLOW_URL="${REACT_APP_PUBLIC_DATAFLOW_URL:-http://localhost:5110}"
export REACT_APP_PUBLIC_SOCKET_URL="${REACT_APP_PUBLIC_SOCKET_URL:-http://localhost:4000}"
export REACT_APP_PUBLIC_SOCKETFLASK_URL="${REACT_APP_PUBLIC_SOCKETFLASK_URL:-http://localhost:4000}"
export REACT_APP_PUBLIC_HLS_URL="${REACT_APP_PUBLIC_HLS_URL:-http://localhost:4440}"

# webpack 4 needs --openssl-legacy-provider under OpenSSL 3 (Node 17+), but Node <17 ships
# OpenSSL 1.1 and REJECTS the flag ("not allowed in NODE_OPTIONS"). Gate on the actual major.
if node -e "process.exit(process.versions.openssl.split('.')[0] >= '3' ? 0 : 1)"; then
  export NODE_OPTIONS="${NODE_OPTIONS:-} --openssl-legacy-provider"
  echo "OpenSSL 3 detected — enabling --openssl-legacy-provider"
else
  echo "OpenSSL 1.x detected — building without --openssl-legacy-provider"
fi

echo "=== 1/4 building frontend ==="
( cd "$FRONTEND_DIR" && CI=false ./node_modules/.bin/react-scripts build ) || fail "build failed"

# ---------------------------------------------------------------------------
# 2. Verify the bundle before it replaces a working deploy
# ---------------------------------------------------------------------------
echo "=== 2/4 verifying bundle ==="
MAIN_JS=$(ls "$FRONTEND_DIR"/build/static/js/main.*.chunk.js 2>/dev/null | head -1)
[ -n "$MAIN_JS" ] || fail "no main chunk produced"
for url in "$REACT_APP_PUBLIC_DATAFLOW_URL" "$REACT_APP_PUBLIC_SOCKET_URL" "$REACT_APP_PUBLIC_HLS_URL"; do
  grep -q "$url" "$MAIN_JS" || fail "bundle is missing '$url' — env vars did not bake in, refusing to deploy"
done
echo "OK: all REACT_APP_PUBLIC_* URLs are present in the bundle"

# ---------------------------------------------------------------------------
# 3. Swap the build in
# ---------------------------------------------------------------------------
echo "=== 3/4 deploying to server/build ==="
rm -rf "$SERVER_DIR/build.prev"
[ -d "$SERVER_DIR/build" ] && mv "$SERVER_DIR/build" "$SERVER_DIR/build.prev"
cp -r "$FRONTEND_DIR/build" "$SERVER_DIR/build" || fail "copy failed — previous build preserved at server/build.prev"
echo "OK: deployed (previous build kept at server/build.prev)"

# ---------------------------------------------------------------------------
# 4. Restart the host
# ---------------------------------------------------------------------------
if [ "$RESTART" -eq 1 ]; then
  echo "=== 4/4 restarting node server on :$PORT ==="
  lsof -ti :$PORT 2>/dev/null | xargs kill -9 2>/dev/null
  sleep 1
  # Fully detach: stdin from /dev/null and BOTH stdout and stderr to the log. If the server
  # inherits this script's stdout, it holds the pipe open for as long as it runs — so
  # `./deploy.sh | tail` would hang forever even though the deploy itself finished.
  ( cd "$SERVER_DIR" && nohup node server.js >> /tmp/node_server.log 2>&1 < /dev/null & disown )
  tries=20
  while [ $tries -gt 0 ]; do
    if curl -fsS --max-time 5 -o /dev/null "http://localhost:$PORT/"; then
      echo "OK: serving at http://localhost:$PORT"
      exit 0
    fi
    sleep 1
    tries=$((tries - 1))
  done
  fail "server did not come up on :$PORT — check /tmp/node_server.log"
else
  echo "=== 4/4 skipped restart (--no-restart) ==="
fi
