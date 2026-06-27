#!/usr/bin/env bash
# Print + copy-to-clipboard a share URL for a study on the VPS Orthanc.
# Uses the production viewer + DICOMweb endpoint at https://1.drtr.uk.
# Usage: ./link.sh <StudyInstanceUID> [ct|mr]
set -euo pipefail

cd "$(dirname "$0")"

VIEWER="${VIEWER_URL:-https://1.drtr.uk}"
DICOMWEB_BASE="${DICOMWEB_URL:-https://1.drtr.uk/dicom-web}"
STUDY="${1:-}"
MOD="${2:-ct}"

if [[ -z "$STUDY" ]]; then
  cat <<EOF
Usage: $0 <StudyInstanceUID> [ct|mr]

Studies on the VPS Orthanc:
EOF
  curl -fsS https://1.drtr.uk/orthanc/studies > /tmp/oids.json
  while read -r oid; do
    curl -fsS "https://1.drtr.uk/orthanc/studies/$oid" > /tmp/s.json 2>/dev/null || continue
    python3 <<'PY' 2>/dev/null
import json
try:
    s = json.load(open("/tmp/s.json"))
except Exception:
    raise SystemExit(0)
pn = s.get("PatientMainDicomTags",{}).get("PatientName","?")
desc = s.get("MainDicomTags",{}).get("StudyDescription","")
suid = s.get("MainDicomTags",{}).get("StudyInstanceUID","")
n = len(s.get("Series",[]))
print(f"  {suid:50}  {pn[:22]:22}  {desc[:22]:22}  series={n}")
PY
  done < <(python3 -c 'import json; [print(x) for x in json.load(open("/tmp/oids.json"))]')
  exit 1
fi

STUDY_ENC=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$STUDY")
DW_ENC=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$DICOMWEB_BASE")
URL="${VIEWER}/?modality=${MOD}&dicomweb=${DW_ENC}&study=${STUDY_ENC}"

echo "$URL"
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$URL" | pbcopy
  echo "(copied to clipboard)"
fi
