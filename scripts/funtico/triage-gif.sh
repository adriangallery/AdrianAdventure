#!/bin/bash
# F1.2 (plan FUNTICO_ADVENTURE): GIF de una carrera de Triage en vertical (390x844, con giro) y otra en horizontal
# (844x390). Graba con el e2e (VIDEO_DIR → page.screencast, necesita ffmpeg) y convierte a GIF.
# En el iMac: turno-pesado -n FUNTICO_ADVENTURE -- scripts/funtico/triage-gif.sh   (tras vite build --mode funtico)
set -euo pipefail
OUT=${OUT:-/var/tmp/funtico/f1-2/gif}
mkdir -p "$OUT"
VIDEO_DIR="$OUT" ONLY=390x844,844x390 SHOTS="$OUT/shots" node scripts/funtico/triage-e2e.mjs
for v in "$OUT"/triage-*.webm; do
  g="${v%.webm}.gif"
  ffmpeg -y -loglevel error -i "$v" -vf "fps=10,scale='min(480,iw)':-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none" "$g"
  echo "$g ($(du -h "$g" | cut -f1))"
done
