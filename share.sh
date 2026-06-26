#!/usr/bin/env bash
# Generate a NeoDW share URL for a study.
# Usage: ./share.sh <StudyInstanceUID> [--ct|--mr] [--viewer NEODW_BASE_URL]
set -euo pipefail

cd "$(dirname "$0")"

STUDY=""
MOD="ct"
VIEWER="${NEODW_URL:-https://1.drtr.uk}"  # prod NeoDW; override via --viewer or NEODW_URL env

while (( "$#" )); do
  case "$1" in
    --ct) MOD="ct"; shift ;;
    --mr) MOD="ct"; shift ;;  # MR uses CT module (both volumetric)
    --viewer) VIEWER="$2"; shift 2 ;;
    *) STUDY="$1"; shift ;;
  esac
done

if [[ -z "$STUDY" ]]; then
  echo "Usage: $0 <StudyInstanceUID> [--ct|--mr] [--viewer <NeoDW URL>]" >&2
  echo "" >&2
  echo "Studies on this server:" >&2
  curl -fsS -u admin:Uo08ZfFJHPywmoBZqdNm http://127.0.0.1:8042/studies | \
    python3 -c '
import sys, json, urllib.request, base64
ids = json.load(sys.stdin)
auth = base64.b64encode(b"admin:Uo08ZfFJHPywmoBZqdNm").decode()
for sid in ids:
    req = urllib.request.Request(f"http://127.0.0.1:8042/studies/{sid}", headers={"Authorization": f"Basic {auth}"})
    s = json.loads(urllib.request.urlopen(req).read())
    suid = s.get("MainDicomTags",{}).get("StudyInstanceUID","")
    desc = s.get("MainDicomTags",{}).get("StudyDescription","")
    pn   = s.get("PatientMainDicomTags",{}).get("PatientName","")
    print(f"  {suid}   {pn}  {desc}")
'
  exit 1
fi

if [[ ! -f tunnel-url.txt ]]; then
  echo "tunnel-url.txt missing. Run ./tunnel.sh first." >&2
  exit 1
fi
PUBLIC="$(cat tunnel-url.txt)"

# Orthanc auth is disabled (security via tunnel-URL obscurity). No token needed.
# URL-encode the StudyInstanceUID for the query string.
STUDY_ENC="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$STUDY")"
DICOMWEB_ENC="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "${PUBLIC}/dicom-web")"

URL="${VIEWER}/?modality=${MOD}&dicomweb=${DICOMWEB_ENC}&study=${STUDY_ENC}"

echo ""
echo "Share this link:"
echo ""
echo "  $URL"
echo ""
echo "(Read-only viewer credentials are embedded in the URL fragment after #.)"
