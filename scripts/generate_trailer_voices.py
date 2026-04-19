#!/usr/bin/env python3
"""Generate narrator voice clips for the trailer using Kokoro TTS.

Run:  python3 scripts/generate_trailer_voices.py
Out:  trailer/voices/*.mp3
"""

import os, subprocess, sys
from pathlib import Path

PROJECT = Path(__file__).parent.parent
VOICE_DIR = PROJECT / "trailer" / "voices"
VOICE_DIR.mkdir(parents=True, exist_ok=True)

# Narrator voice: British male George — deep, cinematic
VOICE = "bm_george"
LANG  = "b"      # b = British English
SPEED = 0.82     # slow for dramatic effect

# Trailer lines with output filenames
LINES = [
    ("every_chain",    "Every chain... has a secret."),
    ("trust_no_one",   "Trust no one."),
    ("every_pixel",    "Every pixel hides something."),
    ("become_someone", "Become... someone else."),
    ("title",          "Zero Adventure Two."),
    ("play_now",       "Play for free. Now."),
]

# Check what already exists
existing = {f.stem for f in VOICE_DIR.glob("*.mp3")}
to_gen = [(name, text) for name, text in LINES if name not in existing]

if not to_gen:
    print(f"All {len(LINES)} clips already exist in {VOICE_DIR}")
    sys.exit(0)

print(f"Generating {len(to_gen)} voice clips with Kokoro ({VOICE}, speed={SPEED})...")

# Load Kokoro once, generate all clips
from kokoro import KPipeline
import soundfile as sf

pipe = KPipeline(lang_code=LANG)

for i, (name, text) in enumerate(to_gen):
    wav_path = VOICE_DIR / f"{name}.wav"
    mp3_path = VOICE_DIR / f"{name}.mp3"

    try:
        for _, _, audio in pipe(text, voice=VOICE, speed=SPEED):
            sf.write(str(wav_path), audio, 24000)
            break
        # Convert to MP3
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(wav_path),
             "-codec:a", "libmp3lame", "-q:a", "2", str(mp3_path)],
            capture_output=True, timeout=30
        )
        wav_path.unlink(missing_ok=True)
        print(f"  [{i+1}/{len(to_gen)}] OK  {name}: \"{text}\"")
    except Exception as e:
        print(f"  [{i+1}/{len(to_gen)}] FAIL {name}: {e}")

print(f"\nDone! Clips in: {VOICE_DIR}")
