#!/usr/bin/env bash
# Print + copy-to-clipboard the current share link for a study.
# Always reads the latest tunnel-url.txt — safe to re-run after a tunnel
# reconnect picks up a new lhr.life URL.
set -euo pipefail

cd "$(dirname "$0")"

STUDY="${1:-}"
MOD="${2:-ct}"

if [[ -z "$STUDY" ]]; then
  cat <<EOF
Usage: $0 <StudyInstanceUID> [ct|mr]

Known studies on this Orthanc:
EOF
  curl -fsS http://127.0.0.1:8042/studies | python3 -c '
import sys, json, urllib.request
ids = json.load(sys.stdin)
for sid in ids:
    s = json.loads(urllib.request.urlopen(f"http://127.0.0.1:8042/studies/{sid}").read())
    pn = s.get("PatientMainDicomTags",{}).get("PatientName","?")
    suid = s.get("MainDicomTags",{}).get("StudyInstanceUID","")
    desc = s.get("MainDicomTags",{}).get("StudyDescription","")
    print(f"  {suid}   {pn}  {desc}")
'
  exit 1
fi

if [[ ! -f tunnel-url.txt ]]; then
  echo "tunnel-url.txt missing. Start ./tunnel-keeper.sh first." >&2
  exit 1
fi
PUBLIC="$(cat tunnel-url.txt)"
VIEWER="${NEODW_URL:-https://1.drtr.uk}"

STUDY_ENC="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$STUDY")"
DICOMWEB_ENC="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "${PUBLIC}/dicom-web")"

URL="${VIEWER}/?modality=${MOD}&dicomweb=${DICOMWEB_ENC}&study=${STUDY_ENC}"

echo "$URL"
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$URL" | pbcopy
  echo "(copied to clipboard)"
fi
