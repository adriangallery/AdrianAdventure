#!/bin/bash
# A12 (tráiler): todo lo pesado en UN turno del semáforo: npm ci, build, preview, grabación de planos, premontaje y
# hoja de contactos. Uso: turno-pesado -n ADVENTURE_SCUMM -- scripts/trailer/pipeline.sh
# Variables: VERTICAL=1 (graba también los verticales), SHOTS="01-crt-escaped …" (por defecto todos los 16:9 por prioridad), FPS (60), FIXED_FPS=1 (no bajar a 30).
# Crear /var/tmp/adv-trailer/STOP para pararlo entre planos. Log: /var/tmp/adv-trailer/pipeline.log
WT=$(cd "$(dirname "$0")/../.." && pwd)
LOG=/var/tmp/adv-trailer/pipeline.log
cd "$WT" || exit 1
echo "== $(date +%T) inicio" >> $LOG
if [ ! -d node_modules/puppeteer ]; then
  npm ci --ignore-scripts --no-audit --no-fund >> $LOG 2>&1 || { echo "npm ci falló" >> $LOG; exit 1; }
fi
echo "== $(date +%T) npm ci ok" >> $LOG
if [ ! -f dist/index.html ]; then
  npx vite build >> $LOG 2>&1 && cp -r assets dist/ || { echo "build falló" >> $LOG; exit 1; }
fi
echo "== $(date +%T) build ok" >> $LOG
npx vite preview --port 4173 --strictPort --host 127.0.0.1 >> /var/tmp/adv-trailer/preview.log 2>&1 &
PREV=$!
trap 'kill $PREV 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -sf http://127.0.0.1:4173/ >/dev/null && break; sleep 1; done
FPS=${FPS:-60}
SHOTS=${SHOTS:-"01-crt-escaped 03-outside-intro 05a-dex-acera 05b-dex-idle 05c-dooris-87 13-lambo 07a-lobby-penny 07b-upstairs-rig 07c-rig-dashboard 07d-cajon 07e-sotano 07f-server-room 09a-pzbot-terminal 09b-chad-fud 09c-montana 09d-clinica-fuera 09e-nurse-gwei 09f-dr-satoshi 09g-veleta 09h-dex-mono 10-gerald 14-titulo 11a-coger 11b-puerta 11c-escotilla 11d-pantalla 11e-correr 11f-transicion 11g-coger2 11h-puerta2 11i-cinematica 11j-correr2 11k-destello"}
first=1
for s in $SHOTS; do
  [ -f /var/tmp/adv-trailer/STOP ] && { echo "STOP" >> $LOG; break; }
  t0=$(date +%s)
  node scripts/trailer/record.mjs $s --fps $FPS >> $LOG 2>&1; rc=$?
  t1=$(date +%s)
  echo "== $(date +%T) $s rc=$rc $((t1-t0)) s fps=$FPS" >> $LOG
  if [ $first = 1 ] && [ -z "$FIXED_FPS" ] && [ $((t1-t0)) -gt 100 ] && [ $FPS = 60 ]; then
    echo "== demasiado lento a 60 fps ($((t1-t0)) s para 7 s): resto a 30 fps" >> $LOG
    FPS=30
  fi
  if [ $first = 1 ] && [ $rc != 0 ]; then echo "== el primer plano falló: paro para no ocupar el carril" >> $LOG; break; fi
  first=0
done
[ -n "$VERTICAL" ] && [ ! -f /var/tmp/adv-trailer/STOP ] && node scripts/trailer/record.mjs v --fps $FPS >> $LOG 2>&1
node scripts/trailer/premontaje.mjs --contactos >> $LOG 2>&1
echo "== $(date +%T) fin" >> $LOG
