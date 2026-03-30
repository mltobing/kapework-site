# ClipDigest

Turn a video clip into a clean, timestamped storyboard PDF.

Built for solo app and game builders: upload a screen recording, get back a compact PDF grid of representative frames you can scan quickly or drop into an AI for review.

## What it does

1. **Upload** — mp4, mov, or webm up to 12 minutes / 500 MB
2. **Scan** — adaptive scan at 0.5–2 fps, downsampled to 64×64 grayscale, computing a visual-difference score between adjacent frames
3. **Select** — picks representative frames using duration-aware budgets, static-clip detection, and near-duplicate suppression
4. **Export** — generates a PDF storyboard (pdf-lib) with orientation-aware layout, and optionally a ZIP of JPEG frames (JSZip)

All processing runs in the browser. No server, no upload, no account.

## PDF layout

The PDF layout is chosen automatically based on the video's display orientation:

| Video orientation | PDF page | Grid | Frames per page |
|---|---|---|---|
| Portrait (height > width) | A4 portrait (595×842 pt) | 3 × 3 | 9 |
| Landscape (width ≥ height) | A4 landscape (842×595 pt) | 2 × 2 | 4 |

Orientation is detected from `videoWidth` / `videoHeight` after metadata loads. Modern browsers report post-rotation intrinsic dimensions, so phone recordings display and export correctly. Square video defaults to the landscape (4/page) layout.

## Detail levels and frame budgets

Frame budgets are orientation-aware. Landscape layouts are stricter because each frame occupies more page area.

**Portrait (9 frames/page):**

| Level | Frames selected | Target pages |
|---|---|---|
| Lean | 9–27 | 1–3 |
| Balanced | 27–63 | 3–7 |
| Detailed | 45–90 | 5–10 |

**Landscape (4 frames/page):**

| Level | Frames selected | Target pages |
|---|---|---|
| Lean | 4–12 | 1–3 |
| Balanced | 8–16 | 2–4 |
| Detailed | 12–24 | 3–6 |

## Long-video Auto summarization

The selection algorithm adapts to video length automatically — no user settings required.

**Adaptive scan cadence:**
- ≤ 2 min → 2 fps (~240 scan points)
- 2–5 min → 1 fps (~300 scan points)
- > 5 min → 0.5 fps (~300 scan points)

Total scan frames are bounded at ~300 regardless of clip length.

**Duration-aware spacing:**
`minSpacing` and `maxSpacing` are derived from `videoDuration ÷ frameBudget` rather than hardcoded per-level constants. This spreads selections across the full timeline for long clips while preserving the original short-clip behaviour.

**Static-clip detection:**
If the median visual-change score across all scan points is below 6/255, the clip is classified as static. Spacing is widened by 1.25× to avoid a PDF full of near-identical screenshots (e.g. long tutorial sessions, idle screen recordings) without suppressing frame count too aggressively.

**Near-duplicate suppression:**
After initial frame selection, consecutive selected frames with average pixel difference < 8/255 are deduplicated — the lower-scored frame is removed. The first and last frames are always protected. Deduplication stops before falling below `minFrames`.

**Full-timeline coverage:**
The gap-fill step inserts midpoints into any interval wider than `maxSpacing`, guaranteeing the beginning, middle, and end of long clips are always represented.

## Seek reliability

All video seeks use a 5-second soft-timeout. If a browser stalls on a seek (observed on Safari with large files), the pipeline continues with the current frame rather than hanging. This produces a slightly degraded scan result at that timestamp but never blocks the analysis.

## Known limitations

- **Browser rotation metadata**: `videoWidth/videoHeight` is post-rotation on modern Chrome and Safari. A small number of older browsers may report raw encoded dimensions, causing portrait phone recordings to be misclassified as landscape. The output is still a valid digest; only the grid layout is affected.
- **Memory on mobile**: 500 MB files are processed frame-by-frame; only one frame is held in canvas memory at a time. Still, very large files on low-memory iOS devices may hit the browser memory limit. The app fails gracefully with a clear error message.
- **No audio/transcript analysis**
- **No frame editing or reordering**
- **No AI summary**
- Very high-motion clips may produce slightly uneven coverage at Lean level

## Running locally

No build step. Serve the repo root with any static server:

```
npx serve .
```

Then visit `http://localhost:3000/apps/clipdigest/` (or use the Netlify dev CLI for subdomain routing).

## Deployment

`clipdigest.kapework.com` is a Netlify domain alias. The edge function (`netlify/edge-functions/subdomain-router.ts`) routes it automatically to `/apps/clipdigest/` — no other config needed.
