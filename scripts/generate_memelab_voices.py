#!/usr/bin/env python3
"""Generate voice clips for MemeLAB + modified scenes using Kokoro TTS."""

import json, hashlib, re, subprocess, sys, os
from pathlib import Path

PROJECT = Path(__file__).parent.parent
VOICE_DIR = PROJECT / "assets" / "audio" / "voice"
SCENES = ["memelab", "server_room", "recovery_pool"]

VOICES = {
    "player": ("am_michael", "a", 0.95),
    "bot":    ("am_adam",    "a", 0.9),
}

def norm(t):
    c = re.sub(r'[^a-z0-9 ]', '', t[:100].lower())
    return '_'.join(re.sub(r'\s+', ' ', c).strip().split()[:6])

def key(pfx, t):
    return f"{pfx}_{norm(t)}_{hashlib.md5(t.encode()).hexdigest()[:8]}"

def extract(ops, out, spk="player"):
    if not ops: return
    for o in ops:
        if not isinstance(o, dict): continue
        if o.get("op") in ("say", "sayBrief"):
            t = o.get("text", "")
            s = o.get("speaker", "").lower()
            c = "bot" if "b.o.t" in s else spk
            if t and len(t) > 5: out.append((c, t))
        for k in ("then", "else", "onSuccess", "onFail", "script", "onEnter"):
            if k in o and isinstance(o[k], list): extract(o[k], out, spk)

def extract_scene(name):
    data = json.load(open(PROJECT / "assets" / "scenes" / name / "scene.json"))
    out = []
    extract(data.get("onEnter", []), out)
    for hs in data.get("regions", {}).get("hotspots", []):
        for v, ops in hs.get("scripts", {}).items(): extract(ops, out)
    for tr in data.get("regions", {}).get("triggers", []):
        extract(tr.get("onEnter", []), out)
    for combo in data.get("combos", []):
        extract(combo.get("script", []), out)
    for tid, tree in data.get("dialogues", {}).items():
        for nid, node in tree.get("nodes", {}).items():
            s = node.get("speaker", "").lower()
            c = "bot" if "b.o.t" in s else "player"
            if node.get("text") and len(node["text"]) > 5: out.append((c, node["text"]))
            extract(node.get("onEnter", []), out, c)
    return out

existing = {f.stem for f in VOICE_DIR.glob("*.mp3")}
all_new = []
for s in SCENES:
    texts = extract_scene(s)
    new = [(c, t) for c, t in texts if key(c, t) not in existing]
    print(f"{s}: {len(new)} new clips")
    all_new.extend(new)

seen = set()
unique = []
for c, t in all_new:
    k = key(c, t)
    if k not in seen:
        seen.add(k)
        unique.append((c, t, k))

print(f"\nGenerating {len(unique)} clips...\n")
if not unique:
    print("Nothing to generate!")
    sys.exit(0)

# Group by language to minimize model loads
by_lang = {}
for c, t, k in unique:
    voice, lang, speed = VOICES.get(c, VOICES["player"])
    by_lang.setdefault(lang, []).append((c, t, k, voice, speed))

# Generate all clips in one Python process per language
for lang, entries in by_lang.items():
    print(f"Loading Kokoro model (lang={lang}) for {len(entries)} clips...")

    # Build a batch script
    lines_json = json.dumps([(t, k, v, sp) for _, t, k, v, sp in entries])
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

    result = subprocess.run(
        ["python3", "-c", batch_script],
        timeout=1800, text=True,
        stdout=sys.stdout, stderr=sys.stderr
    )

# Convert all WAVs to MP3
print("\nConverting WAV to MP3...")
wav_files = list(VOICE_DIR.glob("*.wav"))
for i, wav in enumerate(wav_files):
    mp3 = wav.with_suffix(".mp3")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav), "-codec:a", "libmp3lame", "-q:a", "2", str(mp3)],
        capture_output=True, timeout=30
    )
    wav.unlink(missing_ok=True)
    if (i + 1) % 20 == 0:
        print(f"  Converted {i+1}/{len(wav_files)}")

print(f"  Done: {len(wav_files)} converted\n")

# Output config entries
generated = [(c, t, k) for c, t, k in unique if (VOICE_DIR / f"{k}.mp3").exists()]
print(f"=== {len(generated)} clips generated ===\n")

# Write config snippet to a file
config_path = PROJECT / "scripts" / "voice_config_additions.txt"
with open(config_path, "w") as f:
    f.write("// === VOICE_AUDIO_KEYS additions ===\n")
    for _, _, k in sorted(generated, key=lambda x: x[2]):
        f.write(f"  '{k}',\n")
    f.write("\n// === VOICE_TEXT_MAP additions ===\n")
    for c, t, k in sorted(generated, key=lambda x: x[2]):
        safe = t[:100].replace("\\", "\\\\").replace("'", "\\'")
        f.write(f"  {{ text: '{safe}', key: '{k}' }},\n")

print(f"Config additions written to: {config_path}")
