#!/usr/bin/env bash
# Supervisor: keep an SSH reverse tunnel alive against localhost.run.
# Reconnects on disconnect, persists current public URL to ./tunnel-url.txt,
# and posts a macOS notification when the URL changes (free tier randomizes
# the subdomain on every new session).
#
# Run in foreground (Ctrl+C to stop) or background with:
#   nohup ./tunnel-keeper.sh > tunnel-keeper.log 2>&1 &
set -uo pipefail

cd "$(dirname "$0")"

LOG="$(pwd)/tunnel.log"
URL_FILE="$(pwd)/tunnel-url.txt"
KEEPER_PID="$(pwd)/tunnel-keeper.pid"
echo $$ > "$KEEPER_PID"

trap 'echo ""; echo "[keeper] stopping (PID $$)"; pkill -P $$ ssh 2>/dev/null; rm -f "$KEEPER_PID"; exit 0' INT TERM

notify() {
  # macOS user notification (silent on other platforms).
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$2\" with title \"$1\"" 2>/dev/null || true
  fi
}

upstream_ready() {
  curl -fsS --max-time 5 http://127.0.0.1:8043/system >/dev/null 2>&1
}

ATTEMPT=0
PREV_URL=""

while true; do
  ATTEMPT=$((ATTEMPT + 1))

  # Wait for the local Caddy to come back if Docker bounces.
  while ! upstream_ready; do
    echo "[keeper] waiting for Caddy/Orthanc..."
    sleep 5
  done

  : > "$LOG"
  echo "[keeper] attempt #$ATTEMPT — opening ssh -R 80:127.0.0.1:8043 nokey@localhost.run"

  # Run ssh in foreground so the wait below blocks until disconnect.
  ssh -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R 80:127.0.0.1:8043 nokey@localhost.run \
      >> "$LOG" 2>&1 &
  SSH_PID=$!

  # Parse the URL once it appears.
  URL=""
  for i in $(seq 1 30); do
    if ! kill -0 "$SSH_PID" 2>/dev/null; then break; fi
    if grep -Eo 'https://[a-z0-9]+\.lhr\.life' "$LOG" >/dev/null 2>&1; then
      URL="$(grep -Eo 'https://[a-z0-9]+\.lhr\.life' "$LOG" | head -1)"
      break
    fi
    sleep 1
  done

  if [[ -n "$URL" ]] && curl -fsS --max-time 8 "$URL/system" >/dev/null 2>&1; then
    echo "$URL" > "$URL_FILE"
    if [[ "$URL" != "$PREV_URL" ]]; then
      echo "[keeper] LIVE — $URL  (changed from: ${PREV_URL:-<first connect>})"
      notify "DICOM tunnel up" "$URL"
      PREV_URL="$URL"
    else
      echo "[keeper] LIVE — $URL"
    fi
  else
    echo "[keeper] WARN: ssh registered but tunnel unreachable; killing"
    kill "$SSH_PID" 2>/dev/null || true
  fi

  # Watch the public URL: localhost.run sometimes drops the server-side
  # forwarder while the local ssh process stays alive (no exit signal).
  # If the public URL stops responding for 90 seconds, kill ssh and reconnect.
  if [[ -n "$URL" ]]; then
    FAILS=0
    while kill -0 "$SSH_PID" 2>/dev/null; do
      sleep 30
      if curl -fsS --max-time 8 "$URL/healthz" >/dev/null 2>&1; then
        FAILS=0
      else
        FAILS=$((FAILS + 1))
        echo "[keeper] health probe failed ($FAILS/3)"
        if [[ "$FAILS" -ge 3 ]]; then
          echo "[keeper] tunnel silently dead — forcing reconnect"
          kill "$SSH_PID" 2>/dev/null || true
          break
        fi
      fi
    done
  else
    wait "$SSH_PID" 2>/dev/null
  fi
  wait "$SSH_PID" 2>/dev/null
  RC=$?
  echo "[keeper] ssh exited (rc=$RC). Reconnecting in 3s..."
  sleep 3
done
