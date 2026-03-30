/* ui.js — NameForge UI wiring, state management, and analytics
 *
 * Depends on: engine.js, media.js, ollama.js (all loaded before this script)
 *
 * Analytics events fired (all via KapeworkAnalytics):
 *   app_open              — automatic via KapeworkAnalytics.init()
 *   first_interaction     — on first Generate press
 *   run_start             — when generation begins
 *   run_end               — when results are shown
 *   nameforge_generated   — after each generation (includes lane, vibe, media flags)
 *   nameforge_media_added — when a media file is accepted
 *   nameforge_refined     — when Refine from reactions is triggered
 *   nameforge_local_ai_used — when Ollama enhancement is invoked
 *   primary_action        — on copy / start over
 */

'use strict';

(function () {

  // ─── State ────────────────────────────────────────────────────────────────

  const STATE = {
    brief: {},
    mediaResults: [],        // NameForgeMedia result objects
    resultSet: null,         // last NameForgeEngine result
    reactions: [],           // { name, reaction }
    ollamaStatus: null,      // detect() result
    ollamaModel: null,
    aiEnhancementOn: false,
    generating: false,
    refinePass: 0,
    expandedName: null,      // name card currently expanded
  };

  // Persist last brief to localStorage
  const LS_BRIEF_KEY  = 'nameforge_brief_v1';
  const LS_RESULT_KEY = 'nameforge_last_results_v1';

  // ─── DOM refs (populated after DOMContentLoaded) ──────────────────────────

  let dom = {};

  function q(id)  { return document.getElementById(id); }
  function qa(sel){ return document.querySelectorAll(sel); }

  function cacheDom() {
    dom = {
      // Brief inputs
      productInput:   q('nf-product'),
      audienceInput:  q('nf-audience'),
      avoidInput:     q('nf-avoid'),
      vibeChips:      qa('.nf-vibe-chip'),
      laneChips:      qa('.nf-lane-chip'),

      // Media panel
      mediaToggleBtn: q('nf-media-toggle'),
      mediaPanel:     q('nf-media-panel'),
      imageUploadInput: q('nf-img-upload'),
      imageDropZone:  q('nf-img-zone'),
      imagePreviews:  q('nf-img-previews'),
      pdfUploadInput: q('nf-pdf-upload'),
      pdfDropZone:    q('nf-pdf-zone'),
      pdfPreviews:    q('nf-pdf-previews'),
      videoUploadInput: q('nf-vid-upload'),
      videoDropZone:  q('nf-vid-zone'),
      videoPreviews:  q('nf-vid-previews'),

      // Generate button + progress
      generateBtn:    q('nf-generate'),
      progressArea:   q('nf-progress'),
      progressBar:    q('nf-progress-bar'),
      progressPhase:  q('nf-progress-phase'),

      // Results
      resultsArea:    q('nf-results'),
      clustersWrap:   q('nf-clusters'),
      refineBtn:      q('nf-refine'),
      startOverBtn:   q('nf-start-over'),

      // Reactions toolbar
      reactBar:       q('nf-react-bar'),
      reactBtns:      qa('.nf-react-btn'),

      // Ollama status
      ollamaStatus:   q('nf-ollama-status'),
      ollamaToggle:   q('nf-ollama-toggle'),
      ollamaEnhanceBtn: q('nf-ollama-enhance'),
      ollamaSetupNote: q('nf-ollama-setup'),

      // Expanded name detail panel
      detailPanel:    q('nf-detail-panel'),
      detailClose:    q('nf-detail-close'),
      detailName:     q('nf-detail-name'),
      detailTagline:  q('nf-detail-tagline'),
      detailRationale:q('nf-detail-rationale'),
      detailTaglines: q('nf-detail-taglines'),
      detailPolishBtn:q('nf-detail-polish'),
    };
  }

  // ─── Brief collection ─────────────────────────────────────────────────────

  function collectBrief() {
    const selectedVibes = [...dom.vibeChips]
      .filter(c => c.classList.contains('active'))
      .map(c => c.dataset.vibe);

    const selectedLane = ([...dom.laneChips].find(c => c.classList.contains('active')) || {}).dataset.lane || 'clever';

    const avoidRaw = (dom.avoidInput.value || '').trim();
    const avoidWords = avoidRaw ? avoidRaw.split(/[,\n]+/).map(w => w.trim()).filter(Boolean) : [];

    const mediaNotesArr = STATE.mediaResults.map(r => {
      if (r.type === 'image') return r.caption || '';
      if (r.type === 'pdf')   return r.userNote || '';
      if (r.type === 'video') return r.note || '';
      return '';
    });

    return {
      product_summary:  (dom.productInput.value || '').trim(),
      audience:         (dom.audienceInput.value || '').trim(),
      desired_vibes:    selectedVibes,
      avoid_words:      avoidWords,
      naming_lane:      selectedLane,
      format_type:      inferFormatType(dom.productInput.value || ''),
      notes_from_media: mediaNotesArr.filter(Boolean).join('\n'),
      source_inputs_used: [
        dom.productInput.value.trim() ? 'text' : null,
        STATE.mediaResults.some(r => r.type === 'image') ? 'image' : null,
        STATE.mediaResults.some(r => r.type === 'pdf')   ? 'pdf'   : null,
        STATE.mediaResults.some(r => r.type === 'video') ? 'video' : null,
      ].filter(Boolean),
    };
  }

  function inferFormatType(text) {
    const t = text.toLowerCase();
    if (/\bgame\b|\bpuzzle\b|\bquiz\b/.test(t)) return 'game';
    if (/\bapp\b|\bmobile\b|\bios\b|\bandroid\b/.test(t)) return 'app';
    return 'tool';
  }

  // ─── Chip toggles ─────────────────────────────────────────────────────────

  function initChips() {
    dom.vibeChips.forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
      });
    });

    dom.laneChips.forEach(chip => {
      chip.addEventListener('click', () => {
        dom.laneChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  }

  // ─── Media panel ──────────────────────────────────────────────────────────

  function initMediaPanel() {
    dom.mediaToggleBtn.addEventListener('click', () => {
      const open = dom.mediaPanel.classList.toggle('open');
      dom.mediaToggleBtn.setAttribute('aria-expanded', String(open));
    });

    // Images
    setupDropZone(dom.imageDropZone, dom.imageUploadInput, handleImageFiles);
    dom.imageUploadInput.addEventListener('change', e => handleImageFiles(e.target.files));

    // PDF
    setupDropZone(dom.pdfDropZone, dom.pdfUploadInput, handlePDFFile);
    dom.pdfUploadInput.addEventListener('change', e => handlePDFFile(e.target.files));

    // Video
    setupDropZone(dom.videoDropZone, dom.videoUploadInput, handleVideoFile);
    dom.videoUploadInput.addEventListener('change', e => handleVideoFile(e.target.files));
  }

  function setupDropZone(zone, input, handler) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      handler(e.dataTransfer.files);
    });
    // clicking the zone triggers the hidden input
    zone.addEventListener('click', e => {
      if (e.target !== input) input.click();
    });
  }

  async function handleImageFiles(files) {
    if (!files || !files.length) return;
    showMediaError(null);
    try {
      const results = await NameForgeMedia.handleImages(files);
      // Replace existing images
      STATE.mediaResults = STATE.mediaResults.filter(r => r.type !== 'image');
      STATE.mediaResults.push(...results);
      renderImagePreviews(results);
      KapeworkAnalytics.track('nameforge_media_added', { media_type: 'image', count: results.length });
    } catch (e) {
      showMediaError(e.message || 'Could not load image(s).');
    }
  }

  async function handlePDFFile(files) {
    if (!files || !files.length) return;
    showMediaError(null);
    try {
      const result = await NameForgeMedia.handlePDF(files[0]);
      STATE.mediaResults = STATE.mediaResults.filter(r => r.type !== 'pdf');
      STATE.mediaResults.push(result);
      renderPDFPreview(result);
      KapeworkAnalytics.track('nameforge_media_added', { media_type: 'pdf', pages: result.pageCount });
    } catch (e) {
      showMediaError(e.message || 'Could not process PDF.');
    }
  }

  async function handleVideoFile(files) {
    if (!files || !files.length) return;
    showMediaError(null);
    showVideoProgress(true);
    try {
      const result = await NameForgeMedia.handleVideo(files[0], pct => {
        setVideoProgressPct(pct);
      });
      STATE.mediaResults = STATE.mediaResults.filter(r => r.type !== 'video');
      STATE.mediaResults.push(result);
      renderVideoPreview(result);
      KapeworkAnalytics.track('nameforge_media_added', {
        media_type: 'video',
        duration: Math.round(result.duration),
        frames: result.frameCount,
      });
    } catch (e) {
      showMediaError(e.message || 'Could not process video.');
    } finally {
      showVideoProgress(false);
    }
  }

  function renderImagePreviews(results) {
    dom.imagePreviews.innerHTML = results.map((r, i) => `
      <div class="media-thumb-wrap" data-media-idx="${i}" data-media-type="image">
        <img src="${r.dataUrl}" alt="${escHtml(r.name)}" class="media-thumb" />
        <input
          class="media-caption"
          type="text"
          placeholder="Add a note about this image (optional)"
          value="${escHtml(r.caption || '')}"
          data-img-idx="${i}"
        />
        <button class="media-remove" data-remove-type="image" data-remove-idx="${i}" aria-label="Remove image">✕</button>
      </div>
    `).join('');

    dom.imagePreviews.querySelectorAll('.media-caption').forEach(inp => {
      inp.addEventListener('input', e => {
        const idx = +e.target.dataset.imgIdx;
        const imgResults = STATE.mediaResults.filter(r => r.type === 'image');
        if (imgResults[idx]) imgResults[idx].caption = e.target.value;
      });
    });

    bindRemoveButtons(dom.imagePreviews);
  }

  function renderPDFPreview(result) {
    const firstThumb = result.pages[0]?.thumbnailDataUrl;
    dom.pdfPreviews.innerHTML = `
      <div class="media-thumb-wrap" data-media-type="pdf">
        ${firstThumb ? `<img src="${firstThumb}" alt="PDF page 1" class="media-thumb media-thumb--pdf" />` : ''}
        <div class="media-pdf-info">
          <span class="media-pdf-name">${escHtml(result.file.name)}</span>
          <span class="media-pdf-pages">${result.pageCount} page${result.pageCount !== 1 ? 's' : ''}</span>
        </div>
        <input
          class="media-caption"
          type="text"
          placeholder="Add a note about this document (optional)"
          data-pdf-note="1"
        />
        <button class="media-remove" data-remove-type="pdf" aria-label="Remove PDF">✕</button>
      </div>
    `;

    const noteInput = dom.pdfPreviews.querySelector('[data-pdf-note]');
    if (noteInput) {
      noteInput.addEventListener('input', e => {
        const r = STATE.mediaResults.find(x => x.type === 'pdf');
        if (r) r.userNote = e.target.value;
      });
    }

    bindRemoveButtons(dom.pdfPreviews);
  }

  function renderVideoPreview(result) {
    const keyFrame = result.frames[Math.floor(result.frames.length / 2)];
    dom.videoPreviews.innerHTML = `
      <div class="media-thumb-wrap" data-media-type="video">
        ${keyFrame ? `<img src="${keyFrame.dataUrl}" alt="Video frame" class="media-thumb" />` : ''}
        <div class="media-pdf-info">
          <span class="media-pdf-name">${escHtml(result.file.name)}</span>
          <span class="media-pdf-pages">${result.frameCount} frames · ${fmtDuration(result.duration)}</span>
        </div>
        <input
          class="media-caption"
          type="text"
          placeholder="What does this clip show? (optional)"
          data-vid-note="1"
        />
        <button class="media-remove" data-remove-type="video" aria-label="Remove video">✕</button>
      </div>
    `;

    const noteInput = dom.videoPreviews.querySelector('[data-vid-note]');
    if (noteInput) {
      noteInput.addEventListener('input', e => {
        const r = STATE.mediaResults.find(x => x.type === 'video');
        if (r) r.note = e.target.value;
      });
    }

    bindRemoveButtons(dom.videoPreviews);
  }

  function bindRemoveButtons(container) {
    container.querySelectorAll('.media-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const type = btn.dataset.removeType;
        STATE.mediaResults = STATE.mediaResults.filter(r => r.type !== type);
        if (type === 'image') dom.imagePreviews.innerHTML = '';
        if (type === 'pdf')   dom.pdfPreviews.innerHTML   = '';
        if (type === 'video') dom.videoPreviews.innerHTML  = '';
      });
    });
  }

  function showVideoProgress(show) {
    const el = q('nf-vid-progress');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  function setVideoProgressPct(pct) {
    const bar = q('nf-vid-progress-bar');
    if (bar) bar.style.width = pct + '%';
  }

  function showMediaError(msg) {
    const el = q('nf-media-error');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  // ─── Generation ───────────────────────────────────────────────────────────

  function initGenerate() {
    dom.generateBtn.addEventListener('click', runGenerate);
  }

  async function runGenerate() {
    if (STATE.generating) return;

    const brief = collectBrief();
    if (!brief.product_summary) {
      dom.productInput.focus();
      dom.productInput.classList.add('input-error');
      setTimeout(() => dom.productInput.classList.remove('input-error'), 1200);
      return;
    }

    STATE.brief = brief;
    STATE.reactions = [];
    STATE.refinePass = 0;
    STATE.generating = true;

    KapeworkAnalytics.firstInteraction({ lane: brief.naming_lane, vibes: brief.desired_vibes });
    KapeworkAnalytics.runStart({ lane: brief.naming_lane, has_media: brief.source_inputs_used.length > 1 });

    setPhase('Forging names…', 10);
    showProgress(true);
    dom.generateBtn.disabled = true;
    hideResults();

    // Merge AI brief enrichment if enabled
    let enrichedBrief = brief;
    if (STATE.aiEnhancementOn && STATE.mediaResults.length) {
      setPhase('Asking local AI to read your media…', 30);
      try {
        for (const mr of STATE.mediaResults) {
          const fragment = await NameForgeOllama.analyzeMedia(mr, STATE.ollamaModel);
          enrichedBrief = mergeBriefFragment(enrichedBrief, fragment);
        }
        KapeworkAnalytics.track('nameforge_local_ai_used', { phase: 'media_analysis' });
      } catch (_) {
        // fall through — deterministic still works
      }
    }

    setPhase('Generating candidates…', 55);
    await tick();

    const resultSet = NameForgeEngine.generate(enrichedBrief);
    STATE.resultSet = resultSet;

    setPhase('Clustering results…', 80);
    await tick();

    renderResults(resultSet);

    setPhase('Done', 100);
    await tick();

    showProgress(false);
    showResults(true);
    dom.generateBtn.disabled = false;
    STATE.generating = false;

    // Persist
    try {
      localStorage.setItem(LS_BRIEF_KEY, JSON.stringify(brief));
      localStorage.setItem(LS_RESULT_KEY, JSON.stringify(resultSet));
    } catch (_) {}

    KapeworkAnalytics.runEnd({ outcome: 'complete', lane: brief.naming_lane, cluster_count: resultSet.clusters.length });
    KapeworkAnalytics.track('nameforge_generated', {
      lane:        brief.naming_lane,
      vibes:       brief.desired_vibes.join(','),
      has_media:   brief.source_inputs_used.join(','),
      total_names: resultSet.clusters.reduce((n, c) => n + c.items.length, 0),
    });
  }

  function mergeBriefFragment(brief, fragment) {
    if (!fragment) return brief;
    return {
      ...brief,
      product_summary:  brief.product_summary || fragment.product_type || '',
      audience:         brief.audience || fragment.audience || '',
      core_words:       [...(brief.core_words || []), ...(fragment.core_words || [])],
      visual_mood:      fragment.visual_mood || brief.visual_mood,
      notes_from_media: [brief.notes_from_media, fragment.notes_from_media].filter(Boolean).join('\n'),
    };
  }

  // ─── Refine ───────────────────────────────────────────────────────────────

  function initRefine() {
    dom.refineBtn.addEventListener('click', async () => {
      if (!STATE.resultSet || STATE.generating) return;
      if (!STATE.reactions.length) {
        flashElement(dom.reactBar);
        return;
      }

      STATE.generating = true;
      STATE.refinePass++;
      dom.refineBtn.disabled = true;
      setPhase('Refining from your reactions…', 30);
      showProgress(true);
      hideResults();

      await tick();
      const refined = NameForgeEngine.refine(STATE.resultSet, STATE.reactions);
      STATE.resultSet = refined;
      STATE.reactions = [];

      // Optional AI polish on refine
      if (STATE.aiEnhancementOn) {
        setPhase('Polishing with local AI…', 70);
        await tick();
        try {
          const topNames = refined.clusters.flatMap(c => c.items).slice(0, 8).map(i => i.name);
          const polished = await NameForgeOllama.polishNames(topNames, STATE.brief, STATE.ollamaModel);
          applyPolishToResults(refined, polished);
          KapeworkAnalytics.track('nameforge_local_ai_used', { phase: 'polish' });
        } catch (_) {}
      }

      renderResults(refined);
      showProgress(false);
      showResults(true);
      dom.refineBtn.disabled = false;
      STATE.generating = false;

      KapeworkAnalytics.track('nameforge_refined', { pass: STATE.refinePass, reactions: STATE.reactions.length });
    });

    dom.startOverBtn.addEventListener('click', () => {
      STATE.resultSet = null;
      STATE.reactions = [];
      STATE.refinePass = 0;
      hideResults();
      clearReactions();
      dom.generateBtn.disabled = false;
      KapeworkAnalytics.primaryAction('start_over');
    });
  }

  function applyPolishToResults(resultSet, polishedArr) {
    const byName = {};
    polishedArr.forEach(p => { byName[p.name] = p; });
    resultSet.clusters.forEach(cluster => {
      cluster.items.forEach(item => {
        const p = byName[item.name];
        if (p) {
          if (p.tagline)   item.tagline   = p.tagline;
          if (p.rationale) item.rationale = p.rationale;
          item.aiPolished = true;
        }
      });
    });
  }

  // ─── Reactions ────────────────────────────────────────────────────────────

  function initReactions() {
    dom.reactBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const reaction = btn.dataset.reaction;
        if (!STATE.resultSet) return;

        // Apply to all visible names if no specific name selected, otherwise just selected
        const targetNames = STATE.expandedName
          ? [STATE.expandedName]
          : STATE.resultSet.clusters.flatMap(c => c.items).map(i => i.name);

        targetNames.forEach(name => {
          // Remove prior reactions for same name
          STATE.reactions = STATE.reactions.filter(r => r.name !== name);
          STATE.reactions.push({ name, reaction });
        });

        btn.classList.add('active');
        setTimeout(() => btn.classList.remove('active'), 600);

        if (dom.refineBtn) dom.refineBtn.disabled = false;
      });
    });
  }

  function clearReactions() {
    STATE.reactions = [];
    dom.reactBtns.forEach(b => b.classList.remove('active'));
  }

  // ─── Results rendering ────────────────────────────────────────────────────

  function renderResults(resultSet) {
    dom.clustersWrap.innerHTML = resultSet.clusters.map(cluster => `
      <section class="nf-cluster" aria-label="${escHtml(cluster.label)}">
        <h3 class="nf-cluster-label">${escHtml(cluster.label)}</h3>
        <div class="nf-name-grid">
          ${cluster.items.map(item => renderNameCard(item)).join('')}
        </div>
      </section>
    `).join('');

    // Bind card interactions
    dom.clustersWrap.querySelectorAll('.nf-name-card').forEach(card => {
      card.addEventListener('click', () => {
        const name = card.dataset.name;
        openDetailPanel(name, resultSet);
      });
    });

    dom.clustersWrap.querySelectorAll('.nf-copy-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        copyToClipboard(btn.dataset.copy);
        btn.textContent = 'Copied';
        setTimeout(() => btn.textContent = 'Copy', 1200);
        KapeworkAnalytics.primaryAction('copy', { name: btn.dataset.copy });
      });
    });

    dom.clustersWrap.querySelectorAll('.nf-like-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        btn.classList.toggle('liked');
        const name = btn.dataset.name;
        if (btn.classList.contains('liked')) {
          // Mark as favourite — push a "more_like_this" reaction
          STATE.reactions.push({ name, reaction: 'more_like_this' });
        } else {
          STATE.reactions = STATE.reactions.filter(r => r.name !== name);
        }
      });
    });
  }

  function renderNameCard(item) {
    const aiPill = item.aiPolished
      ? '<span class="nf-ai-pill">AI</span>'
      : '';
    const tagsHtml = (item.tags || []).map(t => `<span class="nf-tag">${escHtml(t)}</span>`).join('');

    return `
      <div class="nf-name-card" data-name="${escHtml(item.name)}" role="button" tabindex="0" aria-label="${escHtml(item.name)}">
        <div class="nf-card-top">
          <span class="nf-name-text">${escHtml(item.name)}</span>
          ${aiPill}
          <button class="nf-like-btn" data-name="${escHtml(item.name)}" aria-label="Favourite ${escHtml(item.name)}">♡</button>
        </div>
        <p class="nf-card-tagline">${escHtml(item.tagline)}</p>
        <div class="nf-card-footer">
          <div class="nf-tags">${tagsHtml}</div>
          <button class="nf-copy-btn" data-copy="${escHtml(item.name)}" aria-label="Copy ${escHtml(item.name)}">Copy</button>
        </div>
      </div>
    `;
  }

  // ─── Detail panel ─────────────────────────────────────────────────────────

  function openDetailPanel(name, resultSet) {
    const item = resultSet.clusters.flatMap(c => c.items).find(i => i.name === name);
    if (!item) return;

    STATE.expandedName = name;

    dom.detailName.textContent     = item.name;
    dom.detailTagline.textContent  = item.tagline;
    dom.detailRationale.textContent = item.rationale;
    dom.detailTaglines.innerHTML   = '';

    dom.detailPanel.classList.add('open');
    dom.detailPanel.setAttribute('aria-hidden', 'false');

    // Wire Polish button
    if (dom.detailPolishBtn) {
      dom.detailPolishBtn.style.display = STATE.aiEnhancementOn ? 'block' : 'none';
      dom.detailPolishBtn.onclick = async () => {
        dom.detailPolishBtn.disabled = true;
        dom.detailPolishBtn.textContent = 'Asking local AI…';
        try {
          const variants = await NameForgeOllama.taglineVariants(item.name, STATE.brief, STATE.ollamaModel);
          dom.detailTaglines.innerHTML = variants.map(v =>
            `<li class="nf-tagline-variant">${escHtml(v)}</li>`
          ).join('');
          KapeworkAnalytics.track('nameforge_local_ai_used', { phase: 'tagline_variants', name: item.name });
        } catch (_) {
          dom.detailTaglines.innerHTML = '<li class="nf-tagline-variant nf-err">Local AI unavailable.</li>';
        }
        dom.detailPolishBtn.disabled = false;
        dom.detailPolishBtn.textContent = 'Get tagline variants';
      };
    }
  }

  function initDetailPanel() {
    dom.detailClose.addEventListener('click', () => {
      dom.detailPanel.classList.remove('open');
      dom.detailPanel.setAttribute('aria-hidden', 'true');
      STATE.expandedName = null;
    });
    dom.detailPanel.addEventListener('click', e => {
      if (e.target === dom.detailPanel) {
        dom.detailPanel.classList.remove('open');
        STATE.expandedName = null;
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && dom.detailPanel.classList.contains('open')) {
        dom.detailPanel.classList.remove('open');
        STATE.expandedName = null;
      }
    });
  }

  // ─── Ollama status ────────────────────────────────────────────────────────

  async function initOllama() {
    const status = await NameForgeOllama.detect();
    STATE.ollamaStatus = status;

    if (status.available) {
      STATE.ollamaModel = NameForgeOllama.pickModel(status.models, true);
      if (dom.ollamaStatus) {
        dom.ollamaStatus.textContent = 'Local AI available';
        dom.ollamaStatus.className   = 'nf-ollama-pill nf-ollama-pill--on';
        dom.ollamaStatus.style.display = 'inline-flex';
      }
      if (dom.ollamaToggle) dom.ollamaToggle.style.display = 'flex';
      if (dom.ollamaSetupNote) dom.ollamaSetupNote.style.display = 'none';
    } else {
      if (dom.ollamaStatus) dom.ollamaStatus.style.display = 'none';
      if (dom.ollamaToggle) dom.ollamaToggle.style.display = 'none';
      if (dom.ollamaSetupNote) {
        dom.ollamaSetupNote.style.display = 'block';
        if (status.needsCors) {
          dom.ollamaSetupNote.textContent = 'Local AI: Ollama detected but blocked by browser CORS. Start Ollama with OLLAMA_ORIGINS="*" to enable.';
        }
      }
    }

    if (dom.ollamaToggle) {
      dom.ollamaToggle.addEventListener('change', e => {
        STATE.aiEnhancementOn = e.target.checked;
        if (dom.ollamaEnhanceBtn) {
          dom.ollamaEnhanceBtn.style.display = STATE.aiEnhancementOn ? 'block' : 'none';
        }
      });
    }

    // Ollama enhance button — re-run with AI on current results
    if (dom.ollamaEnhanceBtn) {
      dom.ollamaEnhanceBtn.style.display = 'none';
      dom.ollamaEnhanceBtn.addEventListener('click', async () => {
        if (!STATE.resultSet || !STATE.aiEnhancementOn) return;
        dom.ollamaEnhanceBtn.disabled = true;
        dom.ollamaEnhanceBtn.textContent = 'Polishing…';
        try {
          const topNames = STATE.resultSet.clusters.flatMap(c => c.items).slice(0, 8).map(i => i.name);
          const polished = await NameForgeOllama.polishNames(topNames, STATE.brief, STATE.ollamaModel);
          applyPolishToResults(STATE.resultSet, polished);
          renderResults(STATE.resultSet);
          KapeworkAnalytics.track('nameforge_local_ai_used', { phase: 'polish_button' });
        } catch (e) {
          dom.ollamaEnhanceBtn.textContent = 'AI unavailable';
        }
        setTimeout(() => {
          dom.ollamaEnhanceBtn.disabled = false;
          dom.ollamaEnhanceBtn.textContent = 'Polish with local AI';
        }, 2000);
      });
    }
  }

  // ─── Progress helpers ─────────────────────────────────────────────────────

  function showProgress(show) {
    dom.progressArea.style.display = show ? 'flex' : 'none';
  }

  function setPhase(label, pct) {
    if (dom.progressPhase) dom.progressPhase.textContent = label;
    if (dom.progressBar)   dom.progressBar.style.width   = pct + '%';
  }

  function hideResults() {
    dom.resultsArea.style.display = 'none';
  }

  function showResults(show) {
    dom.resultsArea.style.display = show ? 'block' : 'none';
  }

  function flashElement(el) {
    if (!el) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 600);
  }

  function tick() {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDuration(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  // ─── Restore last brief from localStorage ────────────────────────────────

  function restoreLastBrief() {
    try {
      const saved = localStorage.getItem(LS_BRIEF_KEY);
      if (!saved) return;
      const brief = JSON.parse(saved);

      if (brief.product_summary && dom.productInput) {
        dom.productInput.value = brief.product_summary;
      }
      if (brief.audience && dom.audienceInput) {
        dom.audienceInput.value = brief.audience;
      }
      if (brief.avoid_words && dom.avoidInput) {
        dom.avoidInput.value = Array.isArray(brief.avoid_words)
          ? brief.avoid_words.join(', ')
          : brief.avoid_words;
      }
      if (brief.desired_vibes) {
        dom.vibeChips.forEach(c => {
          if (brief.desired_vibes.includes(c.dataset.vibe)) c.classList.add('active');
        });
      }
      if (brief.naming_lane) {
        dom.laneChips.forEach(c => {
          c.classList.toggle('active', c.dataset.lane === brief.naming_lane);
        });
      }
    } catch (_) {}
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    cacheDom();
    initChips();
    initMediaPanel();
    initGenerate();
    initRefine();
    initReactions();
    initDetailPanel();
    restoreLastBrief();

    // Probe Ollama in background — don't block UI
    initOllama().catch(() => {});

    KapeworkAnalytics.init('nameforge');
    KapeworkShell.init({ appSlug: 'nameforge', mountId: 'kw-shell-mount' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
