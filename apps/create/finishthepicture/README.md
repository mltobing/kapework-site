# Finish the Picture · Kapework Create

Import a photo — one half stays real, the child draws the other half from
scratch, then "reveals" the original to compare. Printable. **On-device only.**

## How to Run

Static HTML app — no build step. Serve it with any static file server:

```bash
# From the repo root
npx serve .
# Then visit http://localhost:3000/apps/create/finishthepicture/
```

Or open `index.html` directly in a browser (the file picker works; printing
needs a user gesture and pop-ups allowed).

## Privacy (hard requirement)

The imported photo **never leaves the device**. There is no upload and no
network call that carries image data — decoding, drawing, reveal, print and
save all happen in-canvas. Only anonymous analytics *events* (no image data,
no PII) are sent, and they fail silently when offline.

## How It Works

- **Two stacked canvases** inside a sized wrapper:
  - `photoCanvas` (bottom): the photo on one half, paper-white (or a faint
    "ghost") on the drawable half, plus the dashed cut-line divider.
  - `drawCanvas` (top): the child's strokes; Pointer Events bind here.
- **Strokes are stored as normalized vectors** (points in `[0,1]×[0,1]`, width
  as a fraction of canvas width). This is why the drawing survives resize /
  orientation changes and re-renders crisply at print resolution.
- **DPR-aware sizing** keeps lines sharp on retina screens.
- **Adaptive layout** maximises the photo on every device:
  - **Phone:** the canvas goes near full-screen; a slim always-on bar
    sits at the bottom, and a 🎒 **More** button opens a slide-up sheet
    with modes / cut / ghost / exact size / print / worksheet / save / new.
  - **Wide screens (laptop / tablet landscape):** the dock becomes a
    right-hand **side rail**, so the canvas uses the full height.
  - The canvas fills the available space but never upscales beyond the
    photo's own resolution (so it stays crisp). A `ResizeObserver` on the
    stage re-fits on any layout change without losing the drawing.

### "Kid Mode" UI (designed for a 7-year-old)
- **Crayon-sized colour swatches** in a tidy 2×6 grid (46px touch targets),
  with a "pop" animation on selection.
- **Brush size as four big dots** (fine / small / medium / large) that show
  their *true* thickness in the current colour — kids think "thin vs fat,"
  not pixels. An exact 1–40px slider lives in the **More** sheet and stays
  in sync with the dots.
- **Round icon buttons** for eraser and undo; a dominant amber
  **"👀 Hold to Peek!"** hero button so the magic reveal is the obvious
  thing to try.
- **Squash-and-bounce press feedback** on every control (disabled under
  `prefers-reduced-motion`).
- A one-time hand-written **"Draw here! ✏️"** hint bobs over the blank half
  until the first stroke, then disappears. The play area stays clean while
  drawing — no clutter over the photo.
- On phones the top bar **shrinks to just the 🖼️ emoji** while editing to
  give the canvas more height (full title returns on desktop / start screen).

## Modes

| Mode | Behaviour |
|------|-----------|
| **Free Draw** (hero, default) | Blank half is empty; draw your own version, then hold **Reveal** to peek at the original. |
| **Mirror** | Strokes are copied live, mirrored, to the photo side — instant symmetry. |
| **Fold & Flip** | Draw on the blank half, tap **Flip it!** to stamp a mirrored copy across the divider. (Idempotent — re-tapping re-stamps, doesn't pile up.) |

- **Cut line:** vertical (default) or horizontal. Switching the cut clears the
  drawing (confirms first if there's work).
- **Ghost toggle:** faint (~18%) trace of the hidden original under the blank
  half. Default **off** — that's the real challenge; the difficulty dial.

## Reveal

Hold the **Reveal** button (or focus it and hold Space/Enter) to fade the
original photo in across the whole picture, release to fade back — a ~200ms
crossfade so the child can peek and compare repeatedly. Nothing is scored;
the comparison is self-judged, per Kapework philosophy.

## Tools

- 12-colour swatch palette (selected swatch enlarges)
- Brush size: four big size-dot buttons (fine ~2px / small 5px default /
  medium 12px / large 24px), plus an exact 1–40px slider in the More sheet
  (the two stay in sync) — defaults to small for precise, pencil-like drawing
- Eraser (`destination-out` on the draw layer only — never touches the photo)
- Undo (pops the last stroke; instant) · Clear (confirms)
- New photo (re-runs the import flow)

## Export

- **Print my picture** — flattens photo half + drawing at the photo's native
  resolution and opens a print window.
- **Print a worksheet** — title strip + the photo half + an equal blank
  bordered box, so the picture can be finished by hand on paper (the
  distinctive educational angle).
- **Save image** — downloads the flattened PNG.

All three render the resting state (no ghost, no reveal) + the drawing.

## Edge Cases Handled

- **Resize / orientation change mid-draw** re-fits the canvas *without*
  destroying the drawing (normalized strokes re-render at the new size).
- **Large photos** are downscaled to a 2000px longest edge on import.
- **EXIF rotation** is respected via `createImageBitmap(file, { imageOrientation:
  'from-image' })`, with a plain `<img>` decode fallback for older Safari.
- **Offline:** core play works fully; analytics calls fail silently.
- **iOS Safari print:** triggered from a user gesture; warns if pop-ups are
  blocked.

## Analytics Events

Wired through the shared `KapeworkAnalytics` client (slug `finishthepicture`):
`app_open`, `first_interaction`, `run_start`, `photo_imported`,
`mode_selected`, `cut_changed`, `ghost_toggled`, `reveal_used`,
`drawing_completed` (first print/save after ≥4 strokes), `print_picture`,
`print_worksheet`, `save_image`. No image data or PII is ever sent.

## What's NOT in V1

- Cloud storage / accounts / a gallery
- The optional drag-to-wipe "slider reveal"
- Subject isolation / AI assistance
- Backend services
