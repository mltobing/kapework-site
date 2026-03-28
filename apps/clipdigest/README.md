# ClipDigest

Turn a short video into a clean, timestamped storyboard PDF.

Built for solo app and game builders: upload a screen recording, get back a compact PDF grid of representative frames you can scan or drop into an AI.

## What it does

1. **Upload** — mp4, mov, or webm up to 3 minutes / 250 MB
2. **Analyse** — scans the video at ~2 fps, downsampled to 64×64 grayscale, computing a visual-difference score between adjacent frames
3. **Select** — picks representative frames adaptively based on the chosen detail level, ensuring coverage across the full clip and avoiding near-duplicate captures
4. **Export** — generates a PDF storyboard (pdf-lib) and optionally a ZIP of JPEG frames (JSZip)

All processing runs in the browser. No server, no upload, no account.

## Detail levels

| Level    | Target frames | Min spacing | Max spacing |
|----------|---------------|-------------|-------------|
| Lean     | 12–20         | 6 s         | 20 s        |
| Balanced | 20–36         | 3 s         | 10 s        |
| Detailed | 36–60         | 1.5 s       | 6 s         |

The selection algorithm:
- Always includes the start and end of the clip
- Greedily picks the highest visual-change moments that are at least `minSpacing` apart
- Fills coverage gaps wider than `maxSpacing` by inserting midpoints
- Clamps to the level's frame target

## Why Auto mode is the main UX

Technical frame-rate controls (0.2 s / 0.5 s / 1.0 s intervals) produce wildly different outputs depending on clip content. A 1-second interval on a static UI recording yields near-duplicate frames; on a fast-cut gameplay clip it misses key moments. The adaptive diff approach adapts to the content and keeps the output digest compact and useful regardless of clip style.

## v1 constraints

- Browser-only: no backend, no cloud storage
- No audio/transcript analysis
- No frame editing or reordering
- No AI summary
- Safari on iOS is supported; very old mobile browsers may struggle with large files
- Very high-motion clips may produce slightly uneven coverage at Lean level

## Running locally

No build step. Open any file directly in a browser, or serve the repo root with any static server:

```
npx serve .
```

Then visit `http://localhost:3000/apps/clipdigest/` (or the subdomain via the Netlify dev CLI).

## Deployment note

`clipdigest.kapework.com` must be added as a Netlify domain alias in the dashboard. The edge function routes it automatically to `/apps/clipdigest/` — no other config needed.
