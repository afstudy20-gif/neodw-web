#!/usr/bin/env bash
# Idempotent setup: install cloudflared, start docker if needed, bring up Orthanc.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Checking cloudflared"
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "    Installing via brew"
  brew install cloudflared
else
  echo "    OK"
fi

echo "==> Checking Docker daemon"
if ! docker info >/dev/null 2>&1; then
  echo "    Starting Docker Desktop (will wait up to 60s)"
  open -a Docker
  for i in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then echo "    OK"; break; fi
    sleep 1
  done
  if ! docker info >/dev/null 2>&1; then
    echo "    Docker did not start. Open Docker Desktop manually and re-run." >&2
    exit 1
  fi
else
  echo "    OK"
fi

echo "==> Bringing up Orthanc"
docker-compose up -d

echo "==> Waiting for Orthanc"
for i in $(seq 1 30); do
  if curl -fsS -u viewer:CHANGE_ME_VIEWER_PASS http://127.0.0.1:8042/system >/dev/null 2>&1; then
    echo "    OK"
    break
  fi
  sleep 1
done

echo ""
echo "Orthanc up:  http://127.0.0.1:8042  (user: admin / viewer)"
echo "DICOMweb at: http://127.0.0.1:8042/dicom-web/"
echo ""
echo "Next:  ./upload.sh <dicom-folder>"
echo "Then:  ./tunnel.sh"
