# Color Pages · Kapework Create

Turn any photo into a kid-friendly coloring page, then color it in, download, or print.

## How to Run

This is a static HTML app — no build step required. Serve it with any static file server:

```bash
# From the repo root
npx serve .
# Then visit http://localhost:3000/apps/create/coloringpage/
```

Or open `index.html` directly in a browser (camera capture requires HTTPS in production).

## Design & Technical Choices

### Architecture
- **Single HTML file** — matches the existing Kapework app pattern. No framework, no build tools, no external dependencies beyond Google Fonts.
- **100% client-side image processing** — all edge detection and template generation runs in the browser using Canvas API. No server, no API keys, no uploads.

### Image Processing Pipeline
1. Photo is downscaled to max 900px for performance
2. Converted to grayscale
3. Gaussian blur applied (configurable per variant)
4. Sobel edge detection extracts outlines
5. Adaptive thresholding converts to clean binary edges
6. Morphological dilation thickens lines (configurable per variant)
7. Output is black outlines on white background

### Three Coloring Variants
| Variant | Blur | Line Thickness | Detail Level | Best For |
|---------|------|---------------|--------------|----------|
| Simple | Low | Thin | Balanced | Ages 5+ |
| Bold | Medium | Thick | Reduced | Ages 3+ |
| Extra Easy | High | Very thick | Minimal | Ages 2+ |

### Coloring Tools
- **Brush** with adjustable size — simple touch/mouse painting
- **Fill bucket** — flood fill with tolerance for filling enclosed regions
- Template outlines are preserved on top of coloring so lines always stay visible
- Undo stack (up to 20 states) with Ctrl/Cmd+Z keyboard shortcut
- Canvas reset to start over

### Export
- Download B&W coloring page (PNG)
- Download colored version (PNG)
- Print via browser print dialog (opens in new window with print-optimized layout)
- Native share (Web Share API) where supported, with fallback to download

### Visual Design
- Light, warm theme suitable for a children's creative app
- Kapework design language: DM Sans typography, rounded corners, generous whitespace
- Mobile-first responsive layout
- Large tap targets, minimal toolbar

## Browser Limitations & Caveats

- **Camera capture**: Requires HTTPS. Falls back to file picker on unsupported browsers.
- **Web Share API**: Only available on mobile Safari, Chrome Android, and some desktop browsers. Hidden when unavailable — download is always available as fallback.
- **Performance**: Edge detection on large photos can take 2-5 seconds on slower devices. Photos are auto-downscaled to 900px max dimension.
- **Print**: Uses `window.open()` which may be blocked by pop-up blockers. User is notified if this happens.
- **Touch drawing**: `touch-action: none` on the canvas prevents scroll interference. The wrapper area has `touch-action: manipulation` for the rest of the UI.

## What's NOT in V1

- User accounts / cloud storage
- AI-powered subject isolation
- Multi-page coloring books
- Stickers, text, or advanced editing tools
- Backend services
