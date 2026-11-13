#!/usr/bin/env bash
# Encodes the Playwright WebM as a 1080p H.264 MP4 of exactly DEMO_SECONDS.
#
#   bash demo/to-mp4.sh
#   DEMO_SECONDS=60 bash demo/to-mp4.sh
#
# Requires ffmpeg (brew install ffmpeg, or the ubuntu-latest runner image).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IN="${1:-$ROOT/demo/artifacts/enough-demo.webm}"
OUT="${2:-$ROOT/demo/artifacts/enough-demo.mp4}"
DURATION="${DEMO_SECONDS:-60}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required. Install it with: brew install ffmpeg" >&2
  exit 1
fi

if [ ! -f "$IN" ]; then
  echo "No recording at $IN. Run: npm run demo:record" >&2
  exit 1
fi

FADE_START="$(awk "BEGIN { printf \"%.2f\", $DURATION - 1.2 }")"

echo "Encoding $IN -> $OUT (${DURATION}s, 1080p30, H.264)"
ffmpeg -y -hide_banner -loglevel error -i "$IN" \
  -vf "fps=30,tpad=stop_mode=clone:stop_duration=3,fade=t=in:st=0:d=0.5,fade=t=out:st=${FADE_START}:d=1.2,format=yuv420p" \
  -t "$DURATION" \
  -c:v libx264 -preset medium -crf 18 -profile:v high -level 4.0 \
  -movflags +faststart -an "$OUT"

ffmpeg -y -hide_banner -loglevel error -ss 2 -i "$OUT" -frames:v 1 -q:v 2 \
  "$ROOT/demo/artifacts/poster.jpg"

SIZE="$(du -h "$OUT" | awk '{print $1}')"
echo "Wrote $OUT ($SIZE) and demo/artifacts/poster.jpg"
