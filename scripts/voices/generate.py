#!/usr/bin/env python3
"""A0.3 (plan SCUMM): genera con Kokoro los clips que faltan. SOLO en GitHub Actions (workflow voices.yml).

    python scripts/voices/generate.py missing.json [--out assets/audio/voice] [--report generated.json]

missing.json es la salida de `node scripts/voices/extract.mjs --missing` ([{speaker, text, key, ...}]).
Voz, idioma y velocidad por hablante: scripts/voices/voices.json. Kokoro da audio a 24 kHz; se pasa a MP3 mono
24 kHz con libmp3lame -q:a 2 (VBR ~70 kbps), igual que los clips existentes (ffprobe: mono, 24000 Hz, ~72 kbps).
No pisa un mp3 que ya exista. Sale con 1 si algún clip falla (el workflow no hace commit en ese caso).
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


def tts_text(text: str) -> str:
    # acotaciones *servos whir* → sin asteriscos; espacios normales. El texto de la clave no cambia.
    return re.sub(r"\s+", " ", text.replace("*", "")).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("missing")
    ap.add_argument("--out", default=str(ROOT / "assets" / "audio" / "voice"))
    ap.add_argument("--report", default="generated.json")
    args = ap.parse_args()

    entries = json.load(open(args.missing, encoding="utf-8"))
    voices = json.load(open(ROOT / "scripts" / "voices" / "voices.json", encoding="utf-8"))["speakers"]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    todo = [e for e in entries if not (out_dir / f"{e['key']}.mp3").exists()]
    print(f"{len(entries)} faltantes, {len(todo)} por generar")
    if not todo:
        json.dump([], open(args.report, "w"))
        return 0

    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    by_lang = {}
    for e in todo:
        v = voices.get(e["speaker"]) or voices["player"]
        by_lang.setdefault(v["lang"], []).append((e, v))

    done, failed = [], []
    tmp = Path(tempfile.mkdtemp(prefix="voices-"))
    for lang, batch in sorted(by_lang.items()):
        print(f"Kokoro lang={lang}: {len(batch)} clips")
        pipe = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
        for i, (e, v) in enumerate(batch, 1):
            key = e["key"]
            try:
                chunks = [np.asarray(audio) for _, _, audio in pipe(tts_text(e["text"]), voice=v["voice"], speed=v["speed"]) if audio is not None]
                if not chunks:
                    raise RuntimeError("Kokoro no devolvió audio")
                wav = tmp / f"{key}.wav"
                sf.write(str(wav), np.concatenate(chunks), 24000)
                mp3 = out_dir / f"{key}.mp3"
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-ar", "24000",
                                "-codec:a", "libmp3lame", "-q:a", "2", str(mp3)], check=True, timeout=120)
                wav.unlink()
                done.append({"key": key, "speaker": e["speaker"], "voice": v["voice"], "bytes": mp3.stat().st_size, "text": e["text"]})
                print(f"[{lang} {i}/{len(batch)}] OK   {key}")
            except Exception as ex:  # noqa: BLE001 — se informa y se sigue con el resto
                failed.append(key)
                print(f"[{lang} {i}/{len(batch)}] FAIL {key}: {ex}", file=sys.stderr)

    json.dump(done, open(args.report, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    total = sum(d["bytes"] for d in done)
    print(f"generados {len(done)} clips ({total / 1024:.0f} KB), fallos {len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
