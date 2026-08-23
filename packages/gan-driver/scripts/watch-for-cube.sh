#!/bin/bash
# watch-for-cube.sh <seconds>
# Runs scan-adv, tailing the capture for a GAN cube candidate:
#   - device name containing "GAN" (case-insensitive), or
#   - manufacturer data with GAN CIC (0xXX01 -> hex starts "01") and 9-byte payload (22 hex chars total)
# On first hit, keeps capturing 12 more seconds to collect several advertisements, then stops.
set -u
SECONDS_TOTAL="${1:-300}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$DIR/captures/discovery/$(date +%Y%m%d-%H%M%S)-wake-scan.jsonl"
"$DIR/scripts/scan-adv" "$SECONDS_TOTAL" > "$OUT" 2>>"$DIR/captures/discovery/scan.log" &
PID=$!
for _ in $(seq 1 "$SECONDS_TOTAL"); do
  sleep 1
  if grep -qiE '"name":"[^"]*gan[^"]*"|"manufacturerData":"01[0-9a-f]{20}"' "$OUT" 2>/dev/null; then
    sleep 12
    kill "$PID" 2>/dev/null
    echo "FOUND $OUT"
    exit 0
  fi
  kill -0 "$PID" 2>/dev/null || break
done
wait "$PID" 2>/dev/null
echo "NOTFOUND $OUT"
exit 1
