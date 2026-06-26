#!/usr/bin/env bash
# Open an SSH reverse tunnel to localhost.run (free, no install beyond ssh).
# Writes the public URL to ./tunnel-url.txt.
set -euo pipefail

cd "$(dirname "$0")"

if ! curl -fsS http://127.0.0.1:8043/system >/dev/null 2>&1; then
  echo "Caddy proxy not reachable on 127.0.0.1:8043. Run ./setup.sh first." >&2
  exit 1
fi

# Kill any previous instance.
if [[ -f tunnel.pid ]]; then
  kill "$(cat tunnel.pid)" 2>/dev/null || true
  sleep 1
fi

LOG="$(pwd)/tunnel.log"
: > "$LOG"

echo "==> Opening reverse tunnel via localhost.run"
nohup ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -R 80:127.0.0.1:8043 nokey@localhost.run > "$LOG" 2>&1 &
PID=$!
echo $PID > tunnel.pid

URL=""
for i in $(seq 1 30); do
  if grep -Eo 'https://[a-z0-9]+\.lhr\.life' "$LOG" >/dev/null 2>&1; then
    URL="$(grep -Eo 'https://[a-z0-9]+\.lhr\.life' "$LOG" | head -1)"
    break
  fi
  sleep 1
done

if [[ -z "$URL" ]]; then
  echo "Tunnel did not announce a URL within 30s. Check $LOG" >&2
  kill "$PID" 2>/dev/null || true
  exit 1
fi

echo "$URL" > tunnel-url.txt

# Verify tunnel is actually proxying (localhost.run sometimes registers but
# routes to a dead session — catch this before sharing the URL).
sleep 2
if ! curl -fsS --max-time 10 "$URL/system" >/dev/null 2>&1; then
  echo "Tunnel registered but $URL/system is unreachable. Check $LOG" >&2
  exit 1
fi

echo ""
echo "Tunnel live: $URL"
echo "PID:         $PID  (kill: kill \$(cat tunnel.pid))"
echo "Logs:        $LOG"
echo ""
echo "Next:  ./share.sh <StudyInstanceUID> --ct"
