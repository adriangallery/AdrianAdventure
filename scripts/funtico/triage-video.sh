#!/bin/bash
# F1.4 (plan FUNTICO_ADVENTURE): vídeo CON SONIDO de una carrera de Triage en vertical (390x844).
# El e2e en modo VIDEO graba dentro de la página con MediaRecorder: el canvas de Phaser (captureStream) + la salida de
# la cadena maestra del WebAudio (MusicManager.outputNode → MediaStreamDestination), en WebM (VP8 + Opus). Chrome
# headless con --autoplay-policy=no-user-gesture-required. Si hay ffmpeg, además un MP4 (H.264 + AAC) y el volumen
# medio de la pista de audio (para ver que no está muda).
# En el iMac: turno-pesado -n FUNTICO_ADVENTURE -- scripts/funtico/triage-video.sh   (tras npm run build:funtico)
# Variables: OUT (por defecto /var/tmp/funtico/f1-4/video), RENDERER (canvas por defecto), SEED.
set -euo pipefail
OUT=${OUT:-/var/tmp/funtico/f1-4/video}
mkdir -p "$OUT"
WEBM="$OUT/triage-390x844.webm"
VIDEO="$WEBM" ONLY=390x844 SHOTS="$OUT/shots" node scripts/funtico/triage-e2e.mjs
[ -s "$WEBM" ] || { echo "sin vídeo en $WEBM"; exit 1; }
echo "$WEBM ($(du -h "$WEBM" | cut -f1))"
if command -v ffmpeg >/dev/null; then
  ffmpeg -y -loglevel error -i "$WEBM" -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 26 -c:a aac -b:a 128k -movflags +faststart "$OUT/triage-390x844.mp4" \
    && echo "$OUT/triage-390x844.mp4 ($(du -h "$OUT/triage-390x844.mp4" | cut -f1))"
  ffmpeg -hide_banner -nostats -i "$WEBM" -map 0:a -af volumedetect -f null - 2>&1 | grep -E 'mean_volume|max_volume' || echo "sin pista de audio legible"
fi
