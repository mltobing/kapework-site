# NameForge

Names and taglines for apps, games, and tools.

Describe what you're building — or show it — and get names that fit.

---

## What it is

NameForge is a local-first naming studio for builders. It helps you generate:

- App names, game names, tool names
- Taglines and hero lines
- Positioning language

It understands your brief — what the product is, who it's for, what it should feel like, and what to avoid — and produces clustered, scored results from a deterministic engine that works with zero AI and zero network calls.

---

## Why local-first / free to run

NameForge has no paid API dependencies. The core generation engine is entirely deterministic — curated word banks, naming patterns, and scoring heuristics run in the browser. There is nothing to sign up for, no quota to exhaust, and no cloud inference cost.

Optional local AI enhancement via Ollama is available as a progressive layer on top, but the tool is genuinely useful without it.

---

## Architecture

```
apps/nameforge/
  index.html   — shell, CSS, markup
  engine.js    — deterministic naming engine (word banks, patterns, scoring, clustering)
  media.js     — image / PDF / video preprocessing (all browser-side)
  ollama.js    — optional local Ollama detection and enhancement
  ui.js        — DOM wiring, state, analytics event calls
```

### Layer 1 — Deterministic engine (`engine.js`)

Always on. No model required.

1. **Brief expansion** — extracts keyword pools from product summary, audience, vibe selections, and core words
2. **Pattern generation** — applies ~12 named pattern types (direct verb+noun, compound, blend, suffix-word, prefix-word, abstract single, playful, premium, etc.) against the expanded pool
3. **Filter** — removes names containing banned words, removes near-duplicates (Levenshtein ≤ 2)
4. **Score** — ranks by brevity, pronounceability, naming-lane fit, vibe fit, and variety of first letters
5. **Cluster** — buckets results into up to 5 named groups: Clear & Direct, Clever & Compact, Brandable & Minimal, Warm & Playful, Premium & Polished
6. **Per-name output** — name + tagline (template-filled from brief) + rationale + 1–3 tags

**Feedback loop**: reactions (More like this / Less like this / Too generic / Too cute / Too abstract) adjust per-cluster weights. The second-pass `refine()` re-runs the engine with modified weights — no AI needed.

### Layer 2 — Optional Ollama enhancement (`ollama.js`)

Progressive enhancement. If the user has Ollama running locally:

- Probes `http://localhost:11434/api/tags` at load time
- If detected, shows a subtle "Local AI available" status and an enable toggle
- Can analyse uploaded images, PDF pages, and video frames into structured brief fields
- Can polish a shortlist of top candidate names
- Can generate tagline variants for a favourite name
- Prefers vision-capable models (gemma3, llava, moondream) for media analysis; falls back to text models for polish/taglines
- Fails gracefully — if Ollama is unreachable the app continues in deterministic mode

### Media preprocessing (`media.js`)

All processing is local. No data leaves the browser.

| Type | Processing | Ollama absent |
|---|---|---|
| Images (≤3, ≤10 MB each) | FileReader → preview; canvas downscale for Ollama | User adds optional caption used as `notes_from_media` |
| PDF (1 file, ≤50 MB, ≤20 pages) | pdf.js text extraction + page thumbnails at 0.4× scale | Extracted text used directly; user adds optional note |
| Video (1 file, ≤500 MB, ≤5 min recommended) | HTML5 video + canvas adaptive frame extraction (~30 frames) | User adds short note; frames shown as reference |

pdf.js is lazy-loaded only when the user actually uploads a PDF.

---

## Media input limits

| Type | Size | Count | Pages / frames |
|---|---|---|---|
| Images | 10 MB each | 3 max | — |
| PDF | 50 MB | 1 | 20 pages analyzed |
| Video | 500 MB | 1 | ~30 frames extracted; 5 min recommended |

---

## Optional Ollama setup

Ollama is not required. The app works fully without it.

To enable local AI enhancement:

1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull a model (gemma3 is a good default):
   ```
   ollama pull gemma3
   ```
3. Start Ollama with the site origin allowed:
   ```
   OLLAMA_ORIGINS="https://nameforge.kapework.com" ollama serve
   ```
   Or for local dev:
   ```
   OLLAMA_ORIGINS="*" ollama serve
   ```
4. Open NameForge — it will detect Ollama and show a "Local AI available" indicator
5. Toggle "Local AI analysis" on in the media panel

**CORS note:** browsers block cross-origin requests to `http://localhost` from HTTPS pages unless Ollama is started with `OLLAMA_ORIGINS` set. If the status shows a CORS warning, restart Ollama with the correct origin.

---

## Analytics events

All events use the shared `KapeworkAnalytics` wrapper.

| Event | When |
|---|---|
| `app_open` | Automatic on load (via `init()`) |
| `first_interaction` | First Generate press |
| `run_start` | Generation begins |
| `run_end` | Results rendered |
| `nameforge_generated` | After each generation (lane, vibes, media flags, name count) |
| `nameforge_media_added` | When a media file is accepted |
| `nameforge_refined` | When Refine is triggered |
| `nameforge_local_ai_used` | When any Ollama call succeeds |
| `primary_action` | copy, start_over |

---

## Local run instructions

No build step. Served directly by Netlify from the repo.

**Local dev with Netlify CLI:**

```bash
npm install -g netlify-cli   # if not already installed
cd /path/to/kapework-site
netlify dev
```

NameForge will be available at the local dev URL under the `/apps/nameforge/` path, or via the subdomain rewrite if you configure your local hosts file.

**Direct file access (no server needed for basic testing):**

Open `apps/nameforge/index.html` directly in a browser. Note:
- pdf.js loads from CDN — requires internet
- Ollama probe will fire (harmless if Ollama is not running)
- Shared scripts (`/shared/...`) will 404 unless served from a server; wrap them in try/catch or use `netlify dev` instead

---

## Known v1 limitations

- No domain availability check
- No trademark check
- No app store name availability check
- Word banks are English-only
- Taglines are template-generated — Ollama polish produces sharper variants
- Video analysis uses frame sampling, not full temporal understanding
- Ollama cross-origin access requires manual `OLLAMA_ORIGINS` configuration
- PDF text extraction quality depends on whether the PDF has embedded text (scanned PDFs return no text without Ollama vision)

---

## Deployment note

After merging, add `nameforge.kapework.com` as a domain alias in the Netlify dashboard. The edge function router (`netlify/edge-functions/subdomain-router.ts`) handles the rewrite automatically for folder apps — no code change needed.
