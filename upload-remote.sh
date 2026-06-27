#!/usr/bin/env bash
# Upload DICOM files to the VPS Orthanc behind 1.drtr.uk (via /orthanc/ proxy).
# Auth disabled on the remote Orthanc — no credentials needed.
# Usage: ./upload-remote.sh <folder-or-zip>
set -euo pipefail

cd "$(dirname "$0")"

SRC="${1:-}"
URL="${ORTHANC_URL:-https://1.drtr.uk/orthanc}"

if [[ -z "$SRC" ]]; then
  echo "Usage: $0 <folder-or-zip-with-dicoms>" >&2
  echo "Default target: $URL  (override with ORTHANC_URL=...)" >&2
  exit 1
fi
if [[ ! -e "$SRC" ]]; then
  echo "Not found: $SRC" >&2
  exit 1
fi

if [[ "$SRC" == *.zip ]]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  echo "==> Unzipping into $TMP"
  unzip -q "$SRC" -d "$TMP"
  ROOT="$TMP"
else
  ROOT="$SRC"
fi

echo "==> Target: $URL"
echo "==> Scanning DICOM files under $ROOT"
COUNT=0
FAIL=0
START=$(date +%s)
while IFS= read -r -d '' f; do
  case "$(basename "$f")" in
    DICOMDIR|*.txt|*.md|.DS_Store|*.xml) continue ;;
  esac
  if curl -fsS -X POST "$URL/instances" \
       --data-binary "@$f" -H "Content-Type: application/dicom" -o /dev/null --max-time 60; then
    COUNT=$((COUNT+1))
    if (( COUNT % 25 == 0 )); then
      ELAPSED=$(($(date +%s) - START))
      printf "\r    Uploaded: %d  (%ds elapsed)" "$COUNT" "$ELAPSED"
    fi
  else
    FAIL=$((FAIL+1))
  fi
done < <(find "$ROOT" -type f -print0)

ELAPSED=$(($(date +%s) - START))
echo ""
echo "==> Done. Uploaded=$COUNT  Failed=$FAIL  Elapsed=${ELAPSED}s"
echo ""
echo "Studies on $URL:"
URL="$URL" curl -fsS "$URL/studies" | URL="$URL" python3 -c '
import sys, json, urllib.request, os
URL = os.environ["URL"]
ids = json.load(sys.stdin)
for sid in ids:
    s = json.loads(urllib.request.urlopen(f"{URL}/studies/{sid}").read())
    pn = s.get("PatientMainDicomTags",{}).get("PatientName","?")
    desc = s.get("MainDicomTags",{}).get("StudyDescription","")
    suid = s.get("MainDicomTags",{}).get("StudyInstanceUID","")
    n = len(s.get("Series",[]))
    print(f"  {pn[:25]:25}  {desc[:25]:25}  series={n}")
    print(f"    StudyInstanceUID: {suid}")
'
