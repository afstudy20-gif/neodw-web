#!/usr/bin/env bash
# Upload all DICOM files in a folder to local Orthanc.
# Usage: ./upload.sh <folder-or-zip>
set -euo pipefail

cd "$(dirname "$0")"

SRC="${1:-}"
if [[ -z "$SRC" ]]; then
  echo "Usage: $0 <folder-or-zip-with-dicoms>" >&2
  exit 1
fi
if [[ ! -e "$SRC" ]]; then
  echo "Not found: $SRC" >&2
  exit 1
fi

URL="http://127.0.0.1:8042"
AUTH="admin:Uo08ZfFJHPywmoBZqdNm"

# Source: folder of DICOMs OR a zip. Both fan out to per-file POSTs.
if [[ "$SRC" == *.zip ]]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  echo "==> Unzipping into $TMP"
  unzip -q "$SRC" -d "$TMP"
  ROOT="$TMP"
else
  ROOT="$SRC"
fi

echo "==> Scanning DICOM files under $ROOT"
COUNT=0
FAIL=0
# DICOMDIR is index, skip it. Plain .dcm + extension-less files both possible.
while IFS= read -r -d '' f; do
  case "$(basename "$f")" in
    DICOMDIR|*.txt|*.md|.DS_Store) continue ;;
  esac
  if ! head -c 132 "$f" | tail -c 4 | grep -q DICM 2>/dev/null; then
    # Allow no-Part10 headers (some PACS exports). Orthanc will reject if truly bad.
    :
  fi
  if curl -fsS -u "$AUTH" -X POST "$URL/instances" \
       --data-binary "@$f" -H "Content-Type: application/dicom" -o /dev/null; then
    COUNT=$((COUNT+1))
    printf "\r    Uploaded: %d" "$COUNT"
  else
    FAIL=$((FAIL+1))
  fi
done < <(find "$ROOT" -type f -print0)

echo ""
echo "==> Done. Uploaded=$COUNT  Failed=$FAIL"
echo ""
echo "Studies in Orthanc:"
curl -fsS -u "$AUTH" "$URL/studies" | python3 -c '
import sys, json, urllib.request, base64
ids = json.load(sys.stdin)
auth = base64.b64encode(b"admin:Uo08ZfFJHPywmoBZqdNm").decode()
for sid in ids:
    req = urllib.request.Request(f"http://127.0.0.1:8042/studies/{sid}", headers={"Authorization": f"Basic {auth}"})
    s = json.loads(urllib.request.urlopen(req).read())
    desc = s.get("MainDicomTags",{}).get("StudyDescription","")
    sd   = s.get("MainDicomTags",{}).get("StudyDate","")
    suid = s.get("MainDicomTags",{}).get("StudyInstanceUID","")
    pn   = s.get("PatientMainDicomTags",{}).get("PatientName","")
    n    = len(s.get("Series",[]))
    print(f"  {sd}  {pn}  {desc}  series={n}")
    print(f"    StudyInstanceUID: {suid}")
'
