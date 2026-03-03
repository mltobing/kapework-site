#!/usr/bin/env python3
"""
build_soundblender_v1_audio.py

Generate ONLY the audio assets needed for SoundBlender v1:
- phoneme_<unit>.mp3  (tile/unit sounds)
- vowel_<v>_loop.mp3  (for hold-to-stretch)
- word_<word>.mp3 and word_<word>_slow.mp3 (whole words)
- soundblender_manifest_v1.json (preload list)

Requires:
- edge-tts (network)
- ffmpeg

Run (from repo root):
  source .venv/bin/activate
  pip install edge-tts
  python scripts/audio/build_soundblender_v1_audio.py --force

Notes:
- MP3-only as requested.
- For looping MP3: use WebAudio AudioBuffer looping (recommended) to avoid gaps.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Set, Tuple

import edge_tts

DEFAULT_VOICE = "en-US-AnaNeural"
DEFAULT_SAMPLE_RATE = 22050
MP3_QUALITY = "2"  # libmp3lame VBR quality (0 best, 9 worst). 2 is high quality.

# ----------------------------
# Word pool (single source here)
# ----------------------------
SB_WORD_POOL = [
    {"word": "sat",  "emoji": "🪑", "phonemes": ["s", "a", "t"]},
    {"word": "sip",  "emoji": "🥤", "phonemes": ["s", "i", "p"]},
    {"word": "sap",  "emoji": "🌳", "phonemes": ["s", "a", "p"]},
    {"word": "tap",  "emoji": "👆", "phonemes": ["t", "a", "p"]},
    {"word": "tan",  "emoji": "☀️", "phonemes": ["t", "a", "n"]},
    {"word": "tip",  "emoji": "💡", "phonemes": ["t", "i", "p"]},
    {"word": "tin",  "emoji": "🥫", "phonemes": ["t", "i", "n"]},
    {"word": "pat",  "emoji": "🐾", "phonemes": ["p", "a", "t"]},
    {"word": "pan",  "emoji": "🍳", "phonemes": ["p", "a", "n"]},
    {"word": "pin",  "emoji": "📌", "phonemes": ["p", "i", "n"]},
    {"word": "pit",  "emoji": "🕳️", "phonemes": ["p", "i", "t"]},
    {"word": "nap",  "emoji": "😴", "phonemes": ["n", "a", "p"]},
    {"word": "nip",  "emoji": "✂️", "phonemes": ["n", "i", "p"]},
    {"word": "nit",  "emoji": "🔍", "phonemes": ["n", "i", "t"]},
    {"word": "ant",  "emoji": "🐜", "phonemes": ["a", "n", "t"]},
    {"word": "sit",  "emoji": "🪑", "phonemes": ["s", "i", "t"]},
    {"word": "nat",  "emoji": "🦟", "phonemes": ["n", "a", "t"]},
    {"word": "at",   "emoji": "📍", "phonemes": ["a", "t"]},
    {"word": "an",   "emoji": "1️⃣", "phonemes": ["a", "n"]},
    {"word": "in",   "emoji": "📥", "phonemes": ["i", "n"]},
    {"word": "it",   "emoji": "👉", "phonemes": ["i", "t"]},
    {"word": "is",   "emoji": "✅", "phonemes": ["i", "s"]},
    {"word": "tat",  "emoji": "🧵", "phonemes": ["t", "a", "t"]},

    # Added
    {"word": "cat",  "emoji": "🐱", "phonemes": ["c", "a", "t"]},
    {"word": "hat",  "emoji": "🎩", "phonemes": ["h", "a", "t"]},
    {"word": "mat",  "emoji": "🧘", "phonemes": ["m", "a", "t"]},
    {"word": "dog",  "emoji": "🐶", "phonemes": ["d", "o", "g"]},

    # Optional 4-letter
    {"word": "pant", "emoji": "👖", "phonemes": ["p", "a", "n", "t"]},
    {"word": "sand", "emoji": "🏖️", "phonemes": ["s", "a", "n", "d"]},
    {"word": "hand", "emoji": "✋", "phonemes": ["h", "a", "n", "d"]},
    {"word": "mint", "emoji": "🌿", "phonemes": ["m", "i", "n", "t"]},
]

SAFE_UNIT_RE = re.compile(r"^[a-z]{1,5}$")
SAFE_WORD_RE = re.compile(r"^[a-z][a-z'\-]{0,31}$")

VOWELS = {"a", "e", "i", "o", "u"}

# Carrier-word onset extraction for consonants
# (carrier_word, cut_seconds)
CONSONANT_CARRIERS: Dict[str, Tuple[str, float]] = {
    # Continuants
    "s": ("sat", 0.22),
    "m": ("mat", 0.25),
    "n": ("nap", 0.24),
    "h": ("hat", 0.20),

    # Stops (short + fade)
    "t": ("tin", 0.16),
    "p": ("pin", 0.16),
    "d": ("dog", 0.16),
    "g": ("go",  0.16),
    "c": ("cat", 0.16),  # /k/ sound via "cat"
}

# Vowel extraction uses vowel-initial carrier words for short vowel quality.
# (carrier_word, tts_rate, phoneme_end, loop_start, loop_end)
VOWEL_PROFILES: Dict[str, Tuple[str, str, float, float, float]] = {
    "a": ("an",       "-35%", 0.22, 0.06, 0.20),  # short a (/æ/)
    "i": ("it",       "-35%", 0.20, 0.06, 0.18),  # short i (/ɪ/)
    "o": ("octopus",  "-35%", 0.22, 0.06, 0.20),  # short o-ish (/ɑ/ in US)
    # If you later add e/u words, uncomment and tune:
    # "e": ("egg",      "-35%", 0.20, 0.06, 0.18),
    # "u": ("up",       "-35%", 0.20, 0.06, 0.18),
}

def run(cmd: List[str]) -> None:
    subprocess.run(cmd, check=True)

def file_ok(p: Path) -> bool:
    return p.exists() and p.is_file() and p.stat().st_size > 0

def is_safe_unit(u: str) -> bool:
    return bool(SAFE_UNIT_RE.fullmatch(u))

def is_safe_word(w: str) -> bool:
    return bool(SAFE_WORD_RE.fullmatch(w))

async def tts_to_file(*, text: str, out_path: Path, voice: str, rate: str) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)
    await communicate.save(str(out_path))

def ff_process(
    *,
    in_file: Path,
    out_file: Path,
    extra_filter: str = "",
    sample_rate: int = DEFAULT_SAMPLE_RATE,
) -> None:
    """
    Remove leading silence + loudness normalize, then apply extra_filter (e.g., atrim+afade).
    """
    out_file.parent.mkdir(parents=True, exist_ok=True)

    base = (
        "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-55dB,"
        "loudnorm=I=-18:TP=-1.5:LRA=11"
    )
    af = base if not extra_filter else f"{base},{extra_filter}"

    cmd = [
        "ffmpeg", "-y",
        "-i", str(in_file),
        "-ac", "1",
        "-ar", str(sample_rate),
        "-af", af,
        "-codec:a", "libmp3lame",
        "-q:a", MP3_QUALITY,
        str(out_file),
    ]
    run(cmd)

def make_onset_unit(
    *,
    raw_tts_mp3: Path,
    out_mp3: Path,
    cut: float,
    sample_rate: int,
) -> None:
    """
    Keep only the onset portion and fade out so it doesn't click/chop.
    """
    fade_start = max(0.0, cut - 0.06)
    extra = f"atrim=0:{cut},afade=t=out:st={fade_start}:d=0.06"
    ff_process(in_file=raw_tts_mp3, out_file=out_mp3, extra_filter=extra, sample_rate=sample_rate)

def make_vowel_phoneme_and_loop(
    *,
    raw_tts_mp3: Path,
    phoneme_out: Path,
    loop_out: Path,
    phoneme_end: float,
    loop_start: float,
    loop_end: float,
    sample_rate: int,
) -> None:
    # phoneme (short one-shot vowel)
    fade_start = max(0.0, phoneme_end - 0.04)
    phoneme_filter = f"atrim=0:{phoneme_end},afade=t=out:st={fade_start}:d=0.04"
    ff_process(in_file=raw_tts_mp3, out_file=phoneme_out, extra_filter=phoneme_filter, sample_rate=sample_rate)

    # loop segment (add tiny fades to reduce clicks)
    dur = max(0.06, loop_end - loop_start)
    loop_filter = (
        f"atrim={loop_start}:{loop_end},"
        "afade=t=in:st=0:d=0.01,"
        f"afade=t=out:st={max(0.0, dur-0.01)}:d=0.01"
    )
    ff_process(in_file=raw_tts_mp3, out_file=loop_out, extra_filter=loop_filter, sample_rate=sample_rate)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="Repo root (default: .)")
    ap.add_argument("--voice", default=DEFAULT_VOICE, help="Edge TTS voice name")
    ap.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE)
    ap.add_argument("--force", action="store_true", help="Regenerate even if files exist")
    ap.add_argument("--include_e_u_loops", action="store_true", help="Also generate vowel_e_loop and vowel_u_loop (if profiles exist)")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    audio_dir = root / "apps" / "readysetread" / "audio"
    tmp_dir = root / ".audio_tmp_soundblender_v1"
    tmp_dir.mkdir(exist_ok=True)

    # Words + units needed
    words: List[str] = []
    units: Set[str] = set()
    vowels_used: Set[str] = set()

    for item in SB_WORD_POOL:
        w = item["word"].strip().lower()
        if not is_safe_word(w):
            raise SystemExit(f"Unsafe word token: {w}")
        words.append(w)
        for u in item["phonemes"]:
            uu = u.strip().lower()
            if not is_safe_unit(uu):
                raise SystemExit(f"Unsafe unit token: {uu} in word {w}")
            units.add(uu)
            if uu in VOWELS:
                vowels_used.add(uu)

    # We only *need* loops for used vowels, but you can opt into e/u later.
    if args.include_e_u_loops:
        vowels_used |= {"e", "u"}

    # ---- Generate word audio ----
    async def gen_words():
        for w in sorted(set(words)):
            out_norm = audio_dir / f"word_{w}.mp3"
            out_slow = audio_dir / f"word_{w}_slow.mp3"

            if args.force or not file_ok(out_norm):
                raw = tmp_dir / f"word_{w}_raw.mp3"
                await tts_to_file(text=w, out_path=raw, voice=args.voice, rate="+0%")
                ff_process(in_file=raw, out_file=out_norm, extra_filter="", sample_rate=args.sample_rate)

            if args.force or not file_ok(out_slow):
                raw = tmp_dir / f"word_{w}_slow_raw.mp3"
                await tts_to_file(text=w, out_path=raw, voice=args.voice, rate="-35%")
                ff_process(in_file=raw, out_file=out_slow, extra_filter="", sample_rate=args.sample_rate)

    # ---- Generate consonant unit phonemes via carrier onset ----
    async def gen_consonant_units():
        for u in sorted(units):
            if u in VOWELS:
                continue
            out = audio_dir / f"phoneme_{u}.mp3"
            if (not args.force) and file_ok(out):
                continue

            if u not in CONSONANT_CARRIERS:
                raise SystemExit(
                    f"Missing carrier mapping for consonant unit '{u}'. "
                    f"Add it to CONSONANT_CARRIERS."
                )

            carrier, cut = CONSONANT_CARRIERS[u]
            raw = tmp_dir / f"phoneme_{u}_{carrier}_raw.mp3"
            await tts_to_file(text=carrier, out_path=raw, voice=args.voice, rate="-25%")
            make_onset_unit(raw_tts_mp3=raw, out_mp3=out, cut=cut, sample_rate=args.sample_rate)

    # ---- Generate vowel phonemes + vowel loop mp3 ----
    async def gen_vowels():
        for v in sorted(vowels_used):
            if v not in VOWEL_PROFILES:
                raise SystemExit(
                    f"Missing vowel profile for '{v}'. "
                    f"Add it to VOWEL_PROFILES (carrier word + cut times)."
                )

            carrier, rate, phoneme_end, loop_start, loop_end = VOWEL_PROFILES[v]
            phoneme_out = audio_dir / f"phoneme_{v}.mp3"
            loop_out = audio_dir / f"vowel_{v}_loop.mp3"

            if (not args.force) and file_ok(phoneme_out) and file_ok(loop_out):
                continue

            raw = tmp_dir / f"vowel_{v}_{carrier}_raw.mp3"
            await tts_to_file(text=carrier, out_path=raw, voice=args.voice, rate=rate)
            make_vowel_phoneme_and_loop(
                raw_tts_mp3=raw,
                phoneme_out=phoneme_out,
                loop_out=loop_out,
                phoneme_end=phoneme_end,
                loop_start=loop_start,
                loop_end=loop_end,
                sample_rate=args.sample_rate,
            )

    async def run_all():
        audio_dir.mkdir(parents=True, exist_ok=True)

        await gen_words()
        await gen_consonant_units()
        await gen_vowels()

        # Write preload manifest
        required_files: List[str] = []
        for u in sorted(units):
            required_files.append(f"phoneme_{u}.mp3")
        for v in sorted(vowels_used):
            required_files.append(f"vowel_{v}_loop.mp3")
        for w in sorted(set(words)):
            required_files.append(f"word_{w}.mp3")
            required_files.append(f"word_{w}_slow.mp3")

        manifest = {
            "version": "soundblender_v1",
            "voice": args.voice,
            "words": sorted(set(words)),
            "units": sorted(units),
            "vowels_used": sorted(vowels_used),
            "required_files": required_files,
        }
        (audio_dir / "soundblender_manifest_v1.json").write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )

        # Sanity check: 0-byte
        empties = [p for p in audio_dir.glob("*.mp3") if p.stat().st_size == 0]
        if empties:
            raise SystemExit(f"ERROR: 0-byte MP3s generated: {empties[:10]}")

        print("DONE.")
        print("Audio written to:", audio_dir)
        print("Manifest:", audio_dir / "soundblender_manifest_v1.json")
        print("\nQuick listen-check (must NOT be letter names):")
        for f in ["phoneme_c.mp3","phoneme_t.mp3","phoneme_p.mp3","phoneme_a.mp3","phoneme_o.mp3","vowel_a_loop.mp3"]:
            print("  -", (audio_dir / f))

        print("\nIf a vowel sounds wrong, tune VOWEL_PROFILES cut times (phoneme_end / loop_start / loop_end).")

    asyncio.run(run_all())
    return 0

if __name__ == "__main__":
    raise SystemExit(main())