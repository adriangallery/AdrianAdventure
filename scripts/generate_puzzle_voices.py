#!/usr/bin/env python3
"""Generate voice clips for puzzle redesign using Kokoro TTS.

Run: python3 scripts/generate_puzzle_voices.py

Uses the same pipeline as generate_memelab_voices.py — Kokoro TTS
with am_michael for player, am_adam for satoshi.
"""

import json, subprocess, sys, os
from pathlib import Path

PROJECT = Path(__file__).parent.parent
VOICE_DIR = PROJECT / "assets" / "audio" / "voice"
INPUT = PROJECT / "scripts" / "puzzle_redesign_voices.json"

VOICES = {
    "player":  ("am_michael", "a", 0.95),
    "satoshi": ("am_adam",    "a", 0.85),
}

entries = json.load(open(INPUT))
existing = {f.stem for f in VOICE_DIR.glob("*.mp3")}

# Filter to only new clips
new = [(spk, txt, k) for spk, txt, k in entries if k not in existing]
print(f"Total entries: {len(entries)}, New: {len(new)}, Existing: {len(entries) - len(new)}")

if not new:
    print("Nothing to generate!")
    sys.exit(0)

# Group by language
by_lang = {}
for spk, txt, k in new:
    voice, lang, speed = VOICES.get(spk, VOICES["player"])
    by_lang.setdefault(lang, []).append((spk, txt, k, voice, speed))

for lang, batch in by_lang.items():
    print(f"\nLoading Kokoro model (lang={lang}) for {len(batch)} clips...")

    lines_json = json.dumps([(t, k, v, sp) for _, t, k, v, sp in batch])
    batch_script = f"""
import json, sys, os
from kokoro import KPipeline
import soundfile as sf

entries = json.loads('''{lines_json}''')
voice_dir = "{VOICE_DIR}"

pipe = KPipeline(lang_code='{lang}')
total = len(entries)
for i, (text, key, voice, speed) in enumerate(entries):
    wav_path = os.path.join(voice_dir, key + ".wav")
    mp3_path = os.path.join(voice_dir, key + ".mp3")

    if os.path.exists(mp3_path):
        print(f"[{{i+1}}/{{total}}] SKIP {{key[:50]}}")
        continue

    try:
        for _, _, audio in pipe(text, voice=voice, speed=speed):
            sf.write(wav_path, audio, 24000)
            break
        print(f"[{{i+1}}/{{total}}] OK {{key[:50]}}")
    except Exception as e:
        print(f"[{{i+1}}/{{total}}] FAIL {{key[:50]}}: {{e}}")
        continue
"""
    subprocess.run(
        ["python3", "-c", batch_script],
        timeout=1800, text=True,
        stdout=sys.stdout, stderr=sys.stderr
    )

# Convert WAV to MP3
print("\nConverting WAV to MP3...")
wav_files = list(VOICE_DIR.glob("*.wav"))
for i, wav in enumerate(wav_files):
    mp3 = wav.with_suffix(".mp3")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav), "-codec:a", "libmp3lame", "-q:a", "2", str(mp3)],
        capture_output=True, timeout=30
    )
    wav.unlink(missing_ok=True)
    if (i + 1) % 10 == 0:
        print(f"  Converted {i+1}/{len(wav_files)}")
print(f"  Done: {len(wav_files)} converted\n")

# Generate config additions
generated = [(spk, txt, k) for spk, txt, k in new if (VOICE_DIR / f"{k}.mp3").exists()]
print(f"=== {len(generated)} clips generated ===\n")

config_path = PROJECT / "scripts" / "puzzle_voice_config_additions.txt"
with open(config_path, "w") as f:
    f.write("// === VOICE_AUDIO_KEYS additions (puzzle redesign) ===\n")
    for _, _, k in sorted(generated, key=lambda x: x[2]):
        f.write(f"  '{k}',\n")
    f.write("\n// === VOICE_TEXT_MAP additions (puzzle redesign) ===\n")
    for _, t, k in sorted(generated, key=lambda x: x[2]):
        safe = t[:100].replace("\\", "\\\\").replace("'", "\\'")
        f.write(f"  {{ text: '{safe}', key: '{k}' }},\n")

print(f"Config additions written to: {config_path}")
