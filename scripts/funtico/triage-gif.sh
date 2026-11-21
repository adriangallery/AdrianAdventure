#!/bin/bash
# F1.2 (plan FUNTICO_ADVENTURE): GIF de una carrera de Triage en vertical (390x844) y otra en horizontal (844x390).
# El e2e en modo --gif (GIF_DIR) guarda una captura cada ~250 ms de cada carrera (sin giro) y aquí se montan con ffmpeg
# (4 fps = tiempo real, ancho 390/844 px CSS, paleta de 128 colores). Tope: 8 MB por GIF (si se pasa, se rehace
# más pequeño).
# En el iMac: turno-pesado -n FUNTICO_ADVENTURE -- scripts/funtico/triage-gif.sh   (tras npm run build:funtico)
# Variables: OUT (por defecto /var/tmp/funtico/f1-2/gif), RENDERER (canvas por defecto), SKIP_E2E=1 (solo montar).
set -euo pipefail
OUT=${OUT:-/var/tmp/funtico/f1-2/gif}
FRAMES="$OUT/frames"
MAX=$((8 * 1024 * 1024))
mkdir -p "$OUT"
if [ "${SKIP_E2E:-0}" != 1 ]; then
  rm -rf "$FRAMES"
  GIF_DIR="$FRAMES" ONLY=390x844,844x390 SHOTS="$OUT/shots" node scripts/funtico/triage-e2e.mjs --gif
fi
for size in 390x844 844x390; do
  dir="$FRAMES/$size"
  [ -f "$dir/f0001.png" ] || { echo "sin fotogramas en $dir"; exit 1; }
  w=${size%x*}
  g="$OUT/triage-$size.gif"
  for colors in 128 64 32; do
    ffmpeg -y -loglevel error -framerate 4 -i "$dir/f%04d.png" \
      -vf "scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
      -loop 0 "$g"
    [ "$(stat -c %s "$g")" -le "$MAX" ] && break
  done
  echo "$g ($(du -h "$g" | cut -f1), $(ls "$dir" | wc -l) fotogramas, $colors colores)"
  [ "$(stat -c %s "$g")" -le "$MAX" ] || { echo "  > 8 MB"; exit 1; }
done
