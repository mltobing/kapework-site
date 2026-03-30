/* media.js — NameForge media preprocessing
 *
 * Handles image, PDF, and video uploads locally in the browser.
 * No data ever leaves the device. Ollama analysis is wired separately in ollama.js.
 *
 * Limits:
 *   Images : up to 3 files, 10 MB each
 *   PDF    : 1 file, 50 MB max, up to 20 pages analyzed
 *   Video  : 1 file, 500 MB max, up to 5 min recommended, ~30 frames extracted
 *
 * Public API (on window.NameForgeMedia):
 *   handleImages(files)           → Promise<ImageResult[]>
 *   handlePDF(file, maxPages?)    → Promise<PDFResult>
 *   handleVideo(file, onProgress) → Promise<VideoResult>
 *   mediaToBriefNotes(results)    → string   (merges media notes into a text string)
 */

'use strict';

(function () {

  const IMAGE_MAX_BYTES  = 10 * 1024 * 1024;  // 10 MB
  const IMAGE_MAX_COUNT  = 3;
  const PDF_MAX_BYTES    = 50 * 1024 * 1024;  // 50 MB
  const PDF_MAX_PAGES    = 20;
  const VIDEO_MAX_BYTES  = 500 * 1024 * 1024; // 500 MB
  const VIDEO_FRAME_TARGET = 30;
  const VIDEO_MAX_SECONDS  = 5 * 60;          // 5 min

  // ─── Error helpers ────────────────────────────────────────────────────────

  function mediaError(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  // ─── Image handling ───────────────────────────────────────────────────────

  /*
   * Accepts a FileList or array of File objects.
   * Returns array of { file, dataUrl, caption } objects.
   * caption is empty string — user fills it in via UI if Ollama is absent.
   */
  async function handleImages(files) {
    const fileArr = Array.from(files).slice(0, IMAGE_MAX_COUNT);
    const results = [];

    for (const file of fileArr) {
      if (!file.type.startsWith('image/')) {
        throw mediaError('BAD_TYPE', `"${file.name}" is not an image file.`);
      }
      if (file.size > IMAGE_MAX_BYTES) {
        throw mediaError('TOO_LARGE', `"${file.name}" exceeds the 10 MB limit.`);
      }

      const dataUrl = await readFileAsDataUrl(file);
      results.push({ type: 'image', file, dataUrl, caption: '', name: file.name });
    }

    return results;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(mediaError('READ_ERROR', `Could not read "${file.name}".`));
      reader.readAsDataURL(file);
    });
  }

  // ─── PDF handling ─────────────────────────────────────────────────────────

  /*
   * Extracts text and renders thumbnail canvases for up to maxPages pages.
   * Requires pdf.js to be loaded on the page (window.pdfjsLib).
   *
   * Returns:
   *   { file, pageCount, pages: [{ pageNum, text, thumbnailDataUrl }] }
   */
  async function handlePDF(file, maxPages) {
    if (file.size > PDF_MAX_BYTES) {
      throw mediaError('TOO_LARGE', `PDF exceeds the 50 MB limit.`);
    }
    if (!window.pdfjsLib) {
      throw mediaError('NO_PDFJS', 'pdf.js is not loaded. Cannot process PDF.');
    }

    maxPages = Math.min(maxPages || PDF_MAX_PAGES, PDF_MAX_PAGES);

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = pdf.numPages;
    const pagesToProcess = Math.min(pageCount, maxPages);
    const pages = [];

    for (let i = 1; i <= pagesToProcess; i++) {
      const page = await pdf.getPage(i);

      // Extract text
      let text = '';
      try {
        const content = await page.getTextContent();
        text = content.items.map(item => item.str).join(' ').trim();
      } catch (_) {
        text = '';
      }

      // Render thumbnail
      let thumbnailDataUrl = null;
      try {
        const viewport = page.getViewport({ scale: 0.4 });
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.75);
      } catch (_) {
        thumbnailDataUrl = null;
      }

      pages.push({ pageNum: i, text, thumbnailDataUrl });
    }

    return { type: 'pdf', file, pageCount, pages, selectedPages: pages.map(p => p.pageNum) };
  }

  // ─── Video handling ───────────────────────────────────────────────────────

  /*
   * Extracts representative frames from a video using HTML5 video + canvas.
   * Reuses the adaptive scan cadence from ClipDigest:
   *   ≤2 min  → 2 fps scan
   *   2–5 min → 1 fps scan
   *   >5 min  → 0.5 fps scan (capped)
   *
   * onProgress(pct: 0–100) called during extraction.
   *
   * Returns:
   *   { file, duration, orientation, frames: [{ time, dataUrl }] }
   */
  async function handleVideo(file, onProgress) {
    if (!file.type.startsWith('video/')) {
      throw mediaError('BAD_TYPE', `"${file.name}" is not a video file.`);
    }
    if (file.size > VIDEO_MAX_BYTES) {
      throw mediaError('TOO_LARGE', `Video exceeds the 500 MB limit.`);
    }

    const objectUrl = URL.createObjectURL(file);

    try {
      const { video, duration, width, height } = await loadVideoMetadata(objectUrl);
      const orientation = height > width ? 'portrait' : 'landscape';

      if (duration > VIDEO_MAX_SECONDS * 2) {
        // Allow longer videos but warn via returned flag
      }

      // Adaptive scan fps
      let scanFps;
      if (duration <= 120)      scanFps = 2;
      else if (duration <= 300) scanFps = 1;
      else                      scanFps = 0.5;

      // Collect candidate timestamps
      const interval = 1 / scanFps;
      const timestamps = [];
      for (let t = 0; t < duration; t += interval) {
        timestamps.push(t);
      }

      // Cap scan points
      const MAX_SCAN = 300;
      const scanPoints = timestamps.length > MAX_SCAN
        ? subsampleEvenly(timestamps, MAX_SCAN)
        : timestamps;

      // Extract frames
      const frames = [];
      for (let i = 0; i < scanPoints.length; i++) {
        const t = scanPoints[i];
        try {
          const dataUrl = await seekAndCapture(video, t, width, height);
          frames.push({ time: t, dataUrl });
        } catch (_) {
          // skip bad frames
        }
        if (onProgress) onProgress(Math.round((i / scanPoints.length) * 80));
      }

      // Select representative subset
      const selected = selectRepresentativeFrames(frames, VIDEO_FRAME_TARGET);
      if (onProgress) onProgress(100);

      return {
        type: 'video',
        file,
        duration,
        orientation,
        frameCount: selected.length,
        frames: selected,
        note: '',
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function loadVideoMetadata(objectUrl) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload  = 'metadata';
      video.muted    = true;
      video.playsInline = true;
      video.onloadedmetadata = () => {
        resolve({
          video,
          duration: video.duration,
          width:    video.videoWidth,
          height:   video.videoHeight,
        });
      };
      video.onerror = () => reject(mediaError('VIDEO_LOAD', 'Could not load video metadata.'));
      video.src = objectUrl;
    });
  }

  function seekAndCapture(video, time, width, height) {
    return new Promise((resolve, reject) => {
      const THUMB_W = 320;
      const scale   = THUMB_W / width;
      const THUMB_H = Math.round(height * scale);

      const timeout = setTimeout(() => reject(new Error('seek timeout')), 3000);

      video.onseeked = () => {
        clearTimeout(timeout);
        video.onseeked = null;
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = THUMB_W;
          canvas.height = THUMB_H;
          canvas.getContext('2d').drawImage(video, 0, 0, THUMB_W, THUMB_H);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch (e) {
          reject(e);
        }
      };
      video.currentTime = time;
    });
  }

  function subsampleEvenly(arr, n) {
    if (arr.length <= n) return arr;
    const result = [];
    const step = arr.length / n;
    for (let i = 0; i < n; i++) {
      result.push(arr[Math.floor(i * step)]);
    }
    return result;
  }

  // Simple representative selection: evenly spaced across timeline
  function selectRepresentativeFrames(frames, target) {
    if (frames.length <= target) return frames;
    return subsampleEvenly(frames, target);
  }

  // ─── Merge media notes into brief text ───────────────────────────────────

  /*
   * Takes an array of media result objects and merges any user captions /
   * notes / extracted text into a single string for brief.notes_from_media.
   */
  function mediaToBriefNotes(mediaResults) {
    const parts = [];

    for (const r of mediaResults) {
      if (r.type === 'image' && r.caption) {
        parts.push(`Image note: ${r.caption}`);
      }
      if (r.type === 'pdf') {
        const textPages = r.pages
          .filter(p => r.selectedPages.includes(p.pageNum) && p.text)
          .map(p => p.text.slice(0, 400));
        if (textPages.length) {
          parts.push(`PDF content: ${textPages.join(' … ')}`);
        }
        if (r.userNote) parts.push(`PDF note: ${r.userNote}`);
      }
      if (r.type === 'video') {
        if (r.note) parts.push(`Video note: ${r.note}`);
        parts.push(`Video: ${r.frameCount} frames extracted, ${Math.round(r.duration)}s clip.`);
      }
    }

    return parts.join('\n');
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  window.NameForgeMedia = {
    handleImages,
    handlePDF,
    handleVideo,
    mediaToBriefNotes,
    LIMITS: {
      IMAGE_MAX_BYTES,
      IMAGE_MAX_COUNT,
      PDF_MAX_BYTES,
      PDF_MAX_PAGES,
      VIDEO_MAX_BYTES,
      VIDEO_FRAME_TARGET,
    },
  };

}());
