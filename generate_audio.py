#!/usr/bin/env python3
"""
Generate phoneme, word, and partial-blend audio files using edge-tts.
Also generates WAV sound effects locally (no network needed).

Usage:
  pip install edge-tts
  python3 generate_audio.py

Requires internet access for edge-tts (Microsoft Azure TTS).
Sound effects are generated locally with no network.
"""

import asyncio
import os
import struct
import math
import random

VOICE = "en-US-AnaNeural"
OUT_DIR = "apps/readysetread/audio"

# Phoneme pronunciation strings
PHONEMES = {
    "s": "sss",
    "a": "aah",
    "t": "t",
    "p": "p",
    "i": "ih",
    "n": "nnn",
}

# CVC words (Tier 1 only)
WORDS = [
    "sat", "sit", "sip", "sap",
    "tap", "tan", "tip", "tin", "tat",
    "pat", "pan", "pin", "pit",
    "nap", "nip", "nit", "nat",
    "at", "an", "in", "it", "is",
    "ant",
]

# Partial blends (first 2 letters of each word)
PARTIAL_BLENDS = sorted(set(w[:2] for w in WORDS if len(w) >= 2))


async def generate_tts(text, filename, rate="+0%"):
    """Generate a single TTS audio file."""
    import edge_tts
    filepath = os.path.join(OUT_DIR, filename)
    if os.path.exists(filepath):
        return
    communicate = edge_tts.Communicate(text, VOICE, rate=rate)
    await communicate.save(filepath)
    print(f"  Generated: {filename}")


async def generate_all_tts():
    """Generate all TTS audio files (requires network)."""
    tasks = []

    print("Generating phoneme audio...")
    for letter, pronunciation in PHONEMES.items():
        tasks.append(generate_tts(pronunciation, f"phoneme_{letter}.mp3", rate="-20%"))

    print("Generating word audio...")
    for word in WORDS:
        tasks.append(generate_tts(word, f"word_{word}.mp3"))

    print("Generating slow word audio...")
    for word in WORDS:
        spaced = "...".join(list(word))
        tasks.append(generate_tts(spaced, f"word_{word}_slow.mp3", rate="-30%"))

    print("Generating partial blend audio...")
    for blend in PARTIAL_BLENDS:
        tasks.append(generate_tts(blend, f"blend_{blend}.mp3", rate="-10%"))

    await asyncio.gather(*tasks)


def generate_wav_sfx():
    """Generate simple sound effects as WAV files (no network needed)."""
    print("Generating sound effects...")

    sample_rate = 22050

    def write_wav(filename, samples):
        filepath = os.path.join(OUT_DIR, filename)
        n = len(samples)
        data = struct.pack(f"<{n}h", *[max(-32767, min(32767, int(s))) for s in samples])
        with open(filepath, "wb") as f:
            f.write(b"RIFF")
            f.write(struct.pack("<I", 36 + len(data)))
            f.write(b"WAVE")
            f.write(b"fmt ")
            f.write(struct.pack("<I", 16))
            f.write(struct.pack("<H", 1))   # PCM
            f.write(struct.pack("<H", 1))   # mono
            f.write(struct.pack("<I", sample_rate))
            f.write(struct.pack("<I", sample_rate * 2))
            f.write(struct.pack("<H", 2))   # block align
            f.write(struct.pack("<H", 16))  # bits per sample
            f.write(b"data")
            f.write(struct.pack("<I", len(data)))
            f.write(data)
        print(f"  Generated: {filename}")

    # correct.wav - pleasant chime/ding (0.3s)
    dur = 0.3
    n = int(sample_rate * dur)
    samples = []
    for i in range(n):
        t = i / sample_rate
        env = max(0, 1.0 - t / dur) ** 2
        val = (math.sin(2 * math.pi * 880 * t) * 0.4 +
               math.sin(2 * math.pi * 1320 * t) * 0.3 +
               math.sin(2 * math.pi * 1760 * t) * 0.15)
        samples.append(val * env * 20000)
    write_wav("correct.wav", samples)

    # celebrate.wav - ascending arpeggio (0.8s)
    dur = 0.8
    n = int(sample_rate * dur)
    freqs = [523, 659, 784, 1047, 1319]
    note_dur = dur / len(freqs)
    samples = []
    for i in range(n):
        t = i / sample_rate
        note_idx = min(int(t / note_dur), len(freqs) - 1)
        freq = freqs[note_idx]
        local_t = t - note_idx * note_dur
        env = max(0, 1.0 - local_t / note_dur) ** 1.5
        overall_env = max(0, 1.0 - t / dur) ** 0.5
        val = (math.sin(2 * math.pi * freq * t) * 0.5 +
               math.sin(2 * math.pi * freq * 2 * t) * 0.2)
        samples.append(val * env * overall_env * 18000)
    write_wav("celebrate.wav", samples)

    # whoosh.wav - filtered noise sweep (0.3s)
    dur = 0.3
    n = int(sample_rate * dur)
    random.seed(42)
    raw = [random.uniform(-1, 1) * math.sin(math.pi * (i / sample_rate) / dur) ** 2 * 12000
           for i in range(n)]
    smoothed = [raw[0]]
    for i in range(1, len(raw)):
        smoothed.append(smoothed[-1] * 0.7 + raw[i] * 0.3)
    write_wav("whoosh.wav", smoothed)


async def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # Always generate SFX (no network needed)
    generate_wav_sfx()

    # Try TTS (needs network)
    try:
        await generate_all_tts()
    except Exception as e:
        print(f"\nNote: Could not generate TTS audio ({type(e).__name__}: {e})")
        print("The game will fall back to browser speechSynthesis for words.")
        print("Re-run this script with internet access to generate high-quality audio.\n")

    print("Done!")


if __name__ == "__main__":
    asyncio.run(main())
