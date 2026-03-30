/* ollama.js — NameForge optional local Ollama enhancement
 *
 * Progressive enhancement only. The app is fully functional without this.
 *
 * What it does:
 *   - Probes localhost:11434 to detect a running Ollama instance
 *   - Lists available models
 *   - Analyzes uploaded media (images, PDF page thumbnails, video frames)
 *     into structured brief fields
 *   - Polishes a shortlist of top name candidates
 *   - Generates sharper tagline variants for a favourite name
 *
 * CORS note:
 *   Browser pages served from HTTPS cannot usually reach http://localhost
 *   due to mixed-content and CORS restrictions. Ollama must be started with
 *   OLLAMA_ORIGINS="*" (or the specific site origin) for this to work.
 *   On failure we surface a friendly setup note rather than an error.
 *
 * Public API (window.NameForgeOllama):
 *   detect()                          → Promise<DetectResult>
 *   analyzeMedia(mediaResult, model)  → Promise<BriefFragment>
 *   polishNames(names, brief, model)  → Promise<PolishResult[]>
 *   taglineVariants(name, brief, model) → Promise<string[]>
 */

'use strict';

(function () {

  const BASE = 'http://localhost:11434';
  const DETECT_TIMEOUT_MS = 3000;

  // ─── Detection ────────────────────────────────────────────────────────────

  /*
   * Returns:
   *   { available: bool, models: string[], error: string|null, needsCors: bool }
   */
  async function detect() {
    try {
      const res = await fetchWithTimeout(`${BASE}/api/tags`, {}, DETECT_TIMEOUT_MS);
      if (!res.ok) {
        return { available: false, models: [], error: `HTTP ${res.status}`, needsCors: false };
      }
      const data = await res.json();
      const models = (data.models || []).map(m => m.name || m.model || String(m));
      return { available: true, models, error: null, needsCors: false };
    } catch (e) {
      const msg = String(e.message || e);
      // Distinguish CORS / network from "not running"
      const needsCors = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS');
      return {
        available: false,
        models: [],
        error: msg,
        needsCors,
      };
    }
  }

  function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  }

  // ─── Pick best model ──────────────────────────────────────────────────────

  // Prefer vision-capable models for media analysis
  const VISION_PREFERRED = ['gemma3', 'llava', 'bakllava', 'moondream', 'minicpm'];
  const TEXT_PREFERRED   = ['gemma3', 'llama3', 'mistral', 'phi3', 'gemma2', 'qwen'];

  function pickModel(models, needsVision) {
    const preferred = needsVision ? VISION_PREFERRED : TEXT_PREFERRED;
    for (const pref of preferred) {
      const match = models.find(m => m.toLowerCase().includes(pref));
      if (match) return match;
    }
    return models[0] || null;
  }

  // ─── Structured JSON prompting ────────────────────────────────────────────

  async function chat(model, messages, expectJson) {
    const body = {
      model,
      messages,
      stream: false,
      ...(expectJson ? { format: 'json' } : {}),
    };

    const res = await fetchWithTimeout(`${BASE}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }, 30000);

    if (!res.ok) throw new Error(`Ollama chat HTTP ${res.status}`);
    const data = await res.json();
    const text = data.message?.content || data.response || '';

    if (expectJson) {
      try {
        // Extract JSON from response (model may wrap it in markdown)
        const match = text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : JSON.parse(text);
      } catch (_) {
        return null;
      }
    }
    return text;
  }

  // ─── Media analysis → structured brief fragment ───────────────────────────

  /*
   * mediaResult: one of the objects returned by NameForgeMedia
   * model: string model name (optional — auto-picks if omitted)
   *
   * Returns a BriefFragment:
   *   { product_type?, audience?, visual_mood?, core_words[], style_words[], notes_from_media }
   */
  async function analyzeMedia(mediaResult, model) {
    const detectResult = await detect();
    if (!detectResult.available) throw new Error('Ollama not available');

    const useModel = model || pickModel(detectResult.models, mediaResult.type !== 'pdf_text');

    if (mediaResult.type === 'image') {
      return analyzeImage(mediaResult, useModel);
    }
    if (mediaResult.type === 'pdf') {
      return analyzePDF(mediaResult, useModel, detectResult.models);
    }
    if (mediaResult.type === 'video') {
      return analyzeVideoFrames(mediaResult, useModel, detectResult.models);
    }

    throw new Error(`Unknown media type: ${mediaResult.type}`);
  }

  async function analyzeImage(imageResult, model) {
    const prompt = `You are a product naming assistant. Analyze this image and return a JSON object describing what you see for naming purposes.

Return ONLY valid JSON with these fields (all optional, omit if unclear):
{
  "product_type": "string — what kind of product/app/game this appears to be",
  "audience": "string — likely target audience",
  "visual_mood": "string — overall visual mood (e.g. minimal, playful, dark, bright)",
  "core_words": ["array", "of", "key", "nouns", "or", "verbs"],
  "style_words": ["array", "of", "style", "descriptors"],
  "notes_from_media": "string — 1–2 sentence summary"
}`;

    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text',  text: prompt },
          { type: 'image_url', image_url: { url: imageResult.dataUrl } },
        ],
      },
    ];

    const result = await chat(model, messages, true);
    return sanitizeBriefFragment(result);
  }

  async function analyzePDF(pdfResult, model, allModels) {
    // Combine selected page text
    const textContent = pdfResult.pages
      .filter(p => pdfResult.selectedPages.includes(p.pageNum))
      .map(p => p.text)
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 3000);

    // Try vision on first page thumbnail if model supports it
    const hasVision = allModels.some(m =>
      VISION_PREFERRED.some(v => m.toLowerCase().includes(v))
    );

    const textPrompt = `You are a product naming assistant. Based on the following document text, return a JSON object for naming purposes.

Document text:
"""
${textContent || '(no text extracted)'}
"""

Return ONLY valid JSON:
{
  "product_type": "string",
  "audience": "string",
  "visual_mood": "string",
  "core_words": ["array"],
  "style_words": ["array"],
  "notes_from_media": "string — 1–2 sentence summary"
}`;

    const messages = [{ role: 'user', content: textPrompt }];

    // If vision available and we have a thumbnail, add first page image
    if (hasVision && pdfResult.pages[0]?.thumbnailDataUrl) {
      const visionModel = pickModel(allModels, true);
      const visionMessages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: textPrompt },
            { type: 'image_url', image_url: { url: pdfResult.pages[0].thumbnailDataUrl } },
          ],
        },
      ];
      try {
        const result = await chat(visionModel, visionMessages, true);
        return sanitizeBriefFragment(result);
      } catch (_) {
        // fall through to text-only
      }
    }

    const result = await chat(model, messages, true);
    return sanitizeBriefFragment(result);
  }

  async function analyzeVideoFrames(videoResult, model, allModels) {
    // Pick a spread of up to 4 key frames
    const frames = videoResult.frames;
    const keyFrames = frames.length <= 4
      ? frames
      : [
          frames[0],
          frames[Math.floor(frames.length * 0.33)],
          frames[Math.floor(frames.length * 0.66)],
          frames[frames.length - 1],
        ];

    const hasVision = allModels.some(m =>
      VISION_PREFERRED.some(v => m.toLowerCase().includes(v))
    );

    const prompt = `You are a product naming assistant. Analyze these video frames and return a JSON object for naming purposes.

Return ONLY valid JSON:
{
  "product_type": "string",
  "audience": "string",
  "visual_mood": "string",
  "core_words": ["array"],
  "style_words": ["array"],
  "notes_from_media": "string — 1–2 sentence summary of what this video shows"
}`;

    if (hasVision) {
      const visionModel = pickModel(allModels, true);
      const content = [
        { type: 'text', text: prompt },
        ...keyFrames.map(f => ({
          type: 'image_url',
          image_url: { url: f.dataUrl },
        })),
      ];
      try {
        const result = await chat(visionModel, [{ role: 'user', content }], true);
        return sanitizeBriefFragment(result);
      } catch (_) {
        // fall through to note-only
      }
    }

    // No vision — return a fragment with the user's note
    return {
      notes_from_media: videoResult.note || `Video clip: ${Math.round(videoResult.duration)}s, ${videoResult.frameCount} frames.`,
    };
  }

  function sanitizeBriefFragment(raw) {
    if (!raw || typeof raw !== 'object') return {};
    return {
      product_type:     typeof raw.product_type === 'string'  ? raw.product_type.slice(0, 120)  : undefined,
      audience:         typeof raw.audience === 'string'       ? raw.audience.slice(0, 120)       : undefined,
      visual_mood:      typeof raw.visual_mood === 'string'    ? raw.visual_mood.slice(0, 80)     : undefined,
      core_words:       Array.isArray(raw.core_words)          ? raw.core_words.slice(0, 12).map(String) : [],
      style_words:      Array.isArray(raw.style_words)         ? raw.style_words.slice(0, 8).map(String) : [],
      notes_from_media: typeof raw.notes_from_media === 'string' ? raw.notes_from_media.slice(0, 500) : '',
    };
  }

  // ─── Polish top names ─────────────────────────────────────────────────────

  /*
   * Takes up to 10 candidate name strings and a brief.
   * Returns an array of { name, tagline, rationale } with polished suggestions.
   */
  async function polishNames(names, brief, model) {
    const detectResult = await detect();
    if (!detectResult.available) throw new Error('Ollama not available');

    const useModel = model || pickModel(detectResult.models, false);

    const prompt = `You are a product naming expert helping a builder choose the best name.

Product brief:
- What: ${brief.product_summary || 'not specified'}
- Audience: ${brief.audience || 'not specified'}
- Vibe: ${(brief.desired_vibes || []).join(', ') || 'not specified'}
- Lane: ${brief.naming_lane || 'not specified'}
- Avoid: ${(brief.avoid_words || []).join(', ') || 'nothing specified'}

Candidate names to evaluate:
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}

For each name, return a JSON array of objects. Be concise and honest — if a name is weak, say so briefly.

Return ONLY a JSON array:
[
  {
    "name": "ExactNameFromList",
    "tagline": "One short tagline for this name",
    "rationale": "One sentence on why this name works or doesn't for this brief",
    "fit_score": 1-10
  }
]`;

    const messages = [{ role: 'user', content: prompt }];
    const raw = await chat(useModel, messages, true);

    if (!Array.isArray(raw)) return [];

    return raw
      .filter(r => r && typeof r.name === 'string')
      .map(r => ({
        name:      String(r.name).trim(),
        tagline:   typeof r.tagline   === 'string' ? r.tagline.slice(0, 120)   : '',
        rationale: typeof r.rationale === 'string' ? r.rationale.slice(0, 240) : '',
        fit_score: typeof r.fit_score === 'number' ? Math.min(10, Math.max(1, r.fit_score)) : null,
      }))
      .slice(0, 10);
  }

  // ─── Tagline variants for a favourite ────────────────────────────────────

  /*
   * Returns up to 5 tagline variant strings for a chosen name.
   */
  async function taglineVariants(name, brief, model) {
    const detectResult = await detect();
    if (!detectResult.available) throw new Error('Ollama not available');

    const useModel = model || pickModel(detectResult.models, false);

    const prompt = `You are a product copywriter. Write 5 short taglines for the product name "${name}".

Brief:
- What: ${brief.product_summary || 'not specified'}
- Audience: ${brief.audience || 'not specified'}
- Vibe: ${(brief.desired_vibes || []).join(', ') || 'not specified'}

Rules:
- Each tagline must be under 12 words
- No generic startup language
- Keep them distinct from each other
- Match the vibe of the brief

Return ONLY a JSON array of 5 strings:
["tagline 1", "tagline 2", "tagline 3", "tagline 4", "tagline 5"]`;

    const messages = [{ role: 'user', content: prompt }];
    const raw = await chat(useModel, messages, true);

    if (!Array.isArray(raw)) return [];
    return raw.filter(t => typeof t === 'string').slice(0, 5);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  window.NameForgeOllama = {
    detect,
    analyzeMedia,
    polishNames,
    taglineVariants,
    pickModel,
  };

}());
