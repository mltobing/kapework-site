(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────
  const COLS = 8, ROWS = 14;
  const ROWS_PER_ROUND    = 10;
  const CHARGES_PER_ROUND = 3;
  const FALL_MS_BASE      = 2800;
  const FALL_MS_MIN       = 1100;
  const FALL_MS_STEP      = 150;
  const TILT_MS           = 520;
  const CLEAR_MS          = 260;
  const LOCK_MS           = 120;
  const TILT_WINDOW_MS    = 600;
  const HOLD_MS           = 360;
  let CELL = 36, NEXT_CELL = 14;

  // ─── Piece data ──────────────────────────────────────────────────────────────
  const PIECES = {
    I:{color:'#5eead4',shapes:[[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],[[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],[[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],[[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]]]},
    O:{color:'#fbbf24',shapes:[[[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],[[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],[[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],[[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]]]},
    T:{color:'#a78bfa',shapes:[[[0,1,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],[[0,1,0,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]],[[0,0,0,0],[1,1,1,0],[0,1,0,0],[0,0,0,0]],[[0,1,0,0],[1,1,0,0],[0,1,0,0],[0,0,0,0]]]},
    S:{color:'#6ee7b7',shapes:[[[0,1,1,0],[1,1,0,0],[0,0,0,0],[0,0,0,0]],[[0,1,0,0],[0,1,1,0],[0,0,1,0],[0,0,0,0]],[[0,0,0,0],[0,1,1,0],[1,1,0,0],[0,0,0,0]],[[1,0,0,0],[1,1,0,0],[0,1,0,0],[0,0,0,0]]]},
    Z:{color:'#f87171',shapes:[[[1,1,0,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],[[0,0,1,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]],[[0,0,0,0],[1,1,0,0],[0,1,1,0],[0,0,0,0]],[[0,1,0,0],[1,1,0,0],[1,0,0,0],[0,0,0,0]]]},
    J:{color:'#60a5fa',shapes:[[[1,0,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],[[0,1,1,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]],[[0,0,0,0],[1,1,1,0],[0,0,1,0],[0,0,0,0]],[[0,1,0,0],[0,1,0,0],[1,1,0,0],[0,0,0,0]]]},
    L:{color:'#fb923c',shapes:[[[0,0,1,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],[[0,1,0,0],[0,1,0,0],[0,1,1,0],[0,0,0,0]],[[0,0,0,0],[1,1,1,0],[1,0,0,0],[0,0,0,0]],[[1,1,0,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]]]}
  };
  const TYPES = Object.keys(PIECES);
  const PTS = [0, 100, 260, 520, 840];
  const TILT_MULT = 1.6;

  // ─── Anchor sequence (cycles each round) ────────────────────────────────────
  const ANCHOR_SEQ = ['#fbbf24','#a78bfa','#f87171','#60a5fa','#fb923c','#6ee7b7','#5eead4'];
  const ANCHOR_NAMES = {
    '#fbbf24':'Amber','#a78bfa':'Violet','#f87171':'Coral',
    '#60a5fa':'Sky','#fb923c':'Orange','#6ee7b7':'Mint','#5eead4':'Teal'
  };

  // ─── Stats ───────────────────────────────────────────────────────────────────
  const STATS_KEY = 'tiltrix_v3';
  function loadStats() {
    try { return { bestScore:0, bestLines:0, totalRuns:0, ...JSON.parse(localStorage.getItem(STATS_KEY)||'{}') }; }
    catch { return { bestScore:0, bestLines:0, totalRuns:0 }; }
  }
  function saveStats(s) { try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch {} }
  const stats = loadStats();
  function track(name, data) { console.log('[tiltrix]', name, data); }

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const canvas      = document.getElementById('board');
  const ctx         = canvas.getContext('2d');
  const nextCanvas  = document.getElementById('next-canvas');
  const nctx        = nextCanvas.getContext('2d');
  const scoreEl     = document.getElementById('score');
  const goOverlay   = document.getElementById('go-overlay');
  const goDetail    = document.getElementById('go-detail');
  const goBest      = document.getElementById('go-best');
  const boardWrap   = document.getElementById('board-wrap');
  const menuDropdown = document.getElementById('menu-dropdown');
  const statBest    = document.getElementById('stat-best');
  const statLines   = document.getElementById('stat-lines');
  const statRuns    = document.getElementById('stat-runs');
  // Round HUD
  const roundLabel   = document.getElementById('round-label');
  const roundProg    = document.getElementById('round-prog');
  const chargesWrap  = document.getElementById('charges-wrap');
  const anchorSwatchEl = document.getElementById('anchor-swatch');
  // Round overlay
  const roundOverlay  = document.getElementById('round-overlay');
  const roNum         = document.getElementById('ro-num');
  const roScore       = document.getElementById('ro-score');
  const roNextNum     = document.getElementById('ro-next-num');
  const roSwatch      = document.getElementById('ro-swatch');
  const roAnchorText  = document.getElementById('ro-anchor-text');
  const roCharges     = document.getElementById('ro-charges');
  // Hint
  const hintOverlay   = document.getElementById('hint-overlay');
  const hintChargesEl = document.getElementById('hint-charges');
  const hintAnchorLine = document.getElementById('hint-anchor-line');

  // ─── Dynamic board sizing ────────────────────────────────────────────────────
  (function () {
    const fromW = Math.floor((Math.min(window.innerWidth, 400) - 24) / COLS);
    const fromH = Math.floor((window.innerHeight - 200) / ROWS);
    CELL      = Math.max(28, Math.min(48, Math.min(fromW, fromH)));
    NEXT_CELL = Math.max(10, Math.round(CELL * 0.52));
    canvas.width  = COLS * CELL;
    canvas.height = ROWS * CELL;
    const ns = NEXT_CELL * 4 + 4;
    nextCanvas.width = nextCanvas.height = ns;
  })();

  // ─── Game state ──────────────────────────────────────────────────────────────
  let board, piece, nextPiece, bag;
  let score, lines, gameOver;
  // Round state
  let round, roundLines, tiltCharges, anchorColor, fallMs;
  let roundPending, roundTimer;
  // Animation / flow flags
  let animating      = false;
  let tiltWindowOpen = false;
  let tiltWindowEnd  = 0;
  let tiltWindowTimer = null;
  let gravityPaused  = false;
  let lastFall       = 0;
  let lockFlashEnd   = 0;
  let clearFlashEnd  = 0;
  let clearFlashRows = null;
  let turnCount      = 0;
  // Particles + glow
  let particles = [];
  let clearGlow = null;

  // ─── Bag / spawn ─────────────────────────────────────────────────────────────
  function newBag() {
    const a = TYPES.slice();
    for (let i = a.length-1; i > 0; i--) {
      const j = (Math.random()*(i+1))|0;
      [a[i],a[j]] = [a[j],a[i]];
    }
    return a;
  }
  function fromBag() { if (!bag.length) bag = newBag(); return bag.pop(); }
  function makePiece(type) {
    return { type, rot:0, x:2, y:-1, shape:PIECES[type].shapes[0], color:PIECES[type].color };
  }
  function spawnNext() {
    piece = { ...nextPiece, y:-1 };
    nextPiece = makePiece(fromBag());
    if (collides(piece, board)) endGame();
  }

  // ─── Board helpers ───────────────────────────────────────────────────────────
  function emptyBoard() { return Array.from({length:ROWS}, ()=>Array(COLS).fill(null)); }
  function collides(p, b) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      if (!p.shape[r][c]) continue;
      const bx = p.x+c, by = p.y+r;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && b[by][bx]) return true;
    }
    return false;
  }
  function lockPiece(p, b) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      if (p.shape[r][c] && p.y+r >= 0) b[p.y+r][p.x+c] = p.color;
    }
  }
  function clearLines(b) {
    const cleared = [];
    for (let y = ROWS-1; y >= 0; y--) {
      if (b[y].every(Boolean)) { cleared.push(y); b.splice(y,1); b.unshift(Array(COLS).fill(null)); y++; }
    }
    return cleared;
  }

  // ─── Piece controls ──────────────────────────────────────────────────────────
  function tryMove(dx) {
    if (gameOver || tiltWindowOpen || animating || roundPending) return;
    const t = { ...piece, x:piece.x+dx };
    if (!collides(t, board)) piece.x += dx;
  }
  function tryRotate() {
    if (gameOver || tiltWindowOpen || animating || roundPending) return;
    const newRot = (piece.rot+1)%4, newShape = PIECES[piece.type].shapes[newRot];
    const kicks = [0,1,-1,2,-2];
    for (const k of kicks) {
      const t = { ...piece, rot:newRot, shape:newShape, x:piece.x+k };
      if (!collides(t, board)) { Object.assign(piece, t); return; }
    }
  }
  function hardDrop() {
    if (gameOver || tiltWindowOpen || animating || roundPending) return;
    while (!collides({...piece, y:piece.y+1}, board)) piece.y++;
    lockCurrentPiece();
  }
  function autoFall(ts) {
    if (!piece) return;
    if (ts - lastFall < fallMs) return;
    lastFall = ts;
    if (collides({...piece, y:piece.y+1}, board)) lockCurrentPiece();
    else piece.y++;
  }

  // ─── Lock & tilt window ──────────────────────────────────────────────────────
  function lockCurrentPiece() {
    lockPiece(piece, board);
    animating = true;
    lockFlashEnd = performance.now() + LOCK_MS;
    if (navigator.vibrate) navigator.vibrate(12);

    const cleared = clearLines(board);
    if (cleared.length) {
      roundLines += cleared.length;
      score += PTS[Math.min(cleared.length, 4)];
      lines += cleared.length;
      clearFlashRows = cleared;
      clearFlashEnd  = performance.now() + CLEAR_MS;
      clearGlow = { rows:cleared, end:performance.now()+380, color:'#00e5cc' };
      spawnParticles(cleared, '#00e5cc');
      if (cleared.length >= 2) flashBoardBorder();
      track('line_clear', { count:cleared.length, afterTilt:false, score, lines, round });
    }
    updateRoundHUD();
    track('piece_place', { type:piece.type, score, lines, round });

    setTimeout(() => {
      clearFlashRows = null;
      animating = false;
      openTiltWindow();
    }, Math.max(LOCK_MS, cleared.length ? CLEAR_MS : 0) + 30);
  }

  function openTiltWindow() {
    // Skip window (and entire turn) when no charges left
    if (tiltCharges <= 0) { finishTurn(); return; }
    tiltWindowOpen  = true;
    tiltWindowEnd   = performance.now() + TILT_WINDOW_MS;
    turnCount++;
    tiltWindowTimer = setTimeout(autoCloseTiltWindow, TILT_WINDOW_MS);
  }
  function closeTiltWindow() {
    clearTimeout(tiltWindowTimer);
    tiltWindowTimer = null;
    tiltWindowOpen  = false;
  }
  function autoCloseTiltWindow() {
    tiltWindowOpen = false;
    finishTurn();
  }

  // ─── finishTurn ──────────────────────────────────────────────────────────────
  function finishTurn() {
    clearFlashRows = null;
    animating = false;
    if (gameOver) return;
    if (roundLines >= ROWS_PER_ROUND) {
      endRound();
    } else {
      spawnNext();
      lastFall = performance.now();
    }
  }

  // ─── Tilt mechanics ──────────────────────────────────────────────────────────
  function doTilt(dir) {
    if (animating || gameOver || roundPending) return;
    if (tiltCharges <= 0) {
      if (tiltWindowOpen) { closeTiltWindow(); finishTurn(); }
      return;
    }

    const wasWindow = tiltWindowOpen;
    animating = true;
    if (wasWindow) {
      tiltCharges--;
      closeTiltWindow();
    }
    if (navigator.vibrate) navigator.vibrate(18);
    track('board_tilt', { dir, fromWindow:wasWindow, charges:tiltCharges, score, lines, round });

    boardWrap.classList.add(dir < 0 ? 'tilt-left' : 'tilt-right');
    boardWrap.addEventListener('animationend', () =>
      boardWrap.classList.remove('tilt-left','tilt-right'), {once:true});

    setTimeout(() => {
      applyTiltPhysics(dir);
      const tc = clearLines(board);

      if (tc.length) {
        roundLines += tc.length;
        const pts = Math.round(PTS[Math.min(tc.length,4)] * TILT_MULT);
        score += pts;
        lines += tc.length;
        // Regain one charge for 2+ line tilt clear
        if (tc.length >= 2 && tiltCharges < CHARGES_PER_ROUND) tiltCharges++;
        clearFlashRows = tc;
        clearFlashEnd  = performance.now() + CLEAR_MS;
        clearGlow = { rows:tc, end:performance.now()+480, color:'#00e5cc' };
        spawnParticles(tc, '#00e5cc');
        if (tc.length >= 2) flashBoardBorder();
        track('line_clear', { count:tc.length, afterTilt:true, pts, score, lines, round });
      }
      updateRoundHUD();

      const afterClear = () => {
        clearFlashRows = null;
        if (wasWindow) {
          finishTurn();
        } else {
          animating = false;
          lastFall = performance.now();
        }
      };

      if (tc.length) setTimeout(afterClear, CLEAR_MS + 40);
      else afterClear();

    }, TILT_MS * 0.44);
  }

  // Anchored tilt physics: anchored-color cells stay in their column position;
  // all other cells pack toward the tilt direction around them.
  function applyTiltPhysics(dir) {
    // Horizontal phase
    for (let y = 0; y < ROWS; y++) {
      const anchored = [];
      const movable  = [];
      for (let x = 0; x < COLS; x++) {
        const c = board[y][x];
        if (c !== null) {
          if (c === anchorColor) anchored.push({x, color:c});
          else movable.push(c);
        }
      }
      const newRow = Array(COLS).fill(null);
      for (const a of anchored) newRow[a.x] = a.color;

      // Collect slots not occupied by anchored cells
      const slots = [];
      for (let x = 0; x < COLS; x++) { if (newRow[x] === null) slots.push(x); }

      if (dir < 0) {
        // Left tilt: pack movable from the left
        for (let i = 0; i < movable.length; i++) newRow[slots[i]] = movable[i];
      } else {
        // Right tilt: pack movable from the right (preserve L→R order)
        const offset = slots.length - movable.length;
        for (let i = 0; i < movable.length; i++) newRow[slots[offset + i]] = movable[i];
      }
      board[y] = newRow;
    }
    // Vertical phase: gravity
    for (let x = 0; x < COLS; x++) {
      const col = [];
      for (let y = 0; y < ROWS; y++) { if (board[y][x]) col.push(board[y][x]); }
      for (let y = ROWS-1; y >= 0; y--) { board[y][x] = col.length ? col.pop() : null; }
    }
  }

  // ─── Board border flash ───────────────────────────────────────────────────────
  function flashBoardBorder() {
    boardWrap.classList.remove('multi-clear');
    void boardWrap.offsetWidth;
    boardWrap.classList.add('multi-clear');
    boardWrap.addEventListener('animationend', () =>
      boardWrap.classList.remove('multi-clear'), {once:true});
  }

  // ─── Round management ─────────────────────────────────────────────────────────
  function startRound(n) {
    clearTimeout(roundTimer);
    roundPending = false;
    roundOverlay.classList.add('hidden');
    round      = n;
    roundLines = 0;
    tiltCharges = CHARGES_PER_ROUND;
    anchorColor = ANCHOR_SEQ[(n - 1) % ANCHOR_SEQ.length];
    fallMs      = Math.max(FALL_MS_MIN, FALL_MS_BASE - (n - 1) * FALL_MS_STEP);
    updateRoundHUD();
    spawnNext();
    lastFall = performance.now();
  }

  function endRound() {
    roundPending = true;
    const nextRound  = round + 1;
    const nextAnchor = ANCHOR_SEQ[(nextRound - 1) % ANCHOR_SEQ.length];
    const anchorName = ANCHOR_NAMES[nextAnchor];

    roNum.textContent       = `Round ${round} complete`;
    roScore.textContent     = `Score ${score.toLocaleString()} · Lines ${lines}`;
    roNextNum.textContent   = nextRound;
    roSwatch.style.background = nextAnchor;
    roAnchorText.textContent  = `${anchorName} blocks stay rooted`;
    roCharges.textContent     = CHARGES_PER_ROUND;

    roundOverlay.classList.remove('hidden');
    roundTimer = setTimeout(() => startRound(nextRound), 2800);
    roundOverlay.addEventListener('pointerdown', () => startRound(nextRound), {once:true});
  }

  function updateRoundHUD() {
    roundLabel.textContent = `Round ${round}`;
    roundProg.style.width  = `${Math.min(100, (roundLines / ROWS_PER_ROUND) * 100)}%`;

    chargesWrap.innerHTML = '';
    for (let i = 0; i < CHARGES_PER_ROUND; i++) {
      const dot = document.createElement('div');
      dot.className = 'charge-dot' + (i >= tiltCharges ? ' spent' : '');
      chargesWrap.appendChild(dot);
    }

    anchorSwatchEl.style.background = anchorColor;
  }

  // ─── First-session hint ───────────────────────────────────────────────────────
  const HINT_KEY = 'tiltrix_hint_v1';
  function initHint() {
    if (localStorage.getItem(HINT_KEY)) return;
    hintChargesEl.textContent  = CHARGES_PER_ROUND;
    hintAnchorLine.textContent = `${ANCHOR_NAMES[anchorColor]} blocks stay rooted when you tilt`;
    hintOverlay.classList.remove('hidden');
    const dismiss = () => {
      hintOverlay.classList.add('hint-fade-out');
      setTimeout(() => hintOverlay.classList.add('hidden'), 700);
      localStorage.setItem(HINT_KEY, '1');
    };
    const timer = setTimeout(dismiss, 6000);
    hintOverlay.addEventListener('pointerdown', () => { clearTimeout(timer); dismiss(); }, {once:true});
  }

  // ─── Particle system ──────────────────────────────────────────────────────────
  function spawnParticles(rows, color) {
    for (const row of rows) {
      for (let x = 0; x < COLS; x += 2) {
        const ang = (Math.random()-0.5)*Math.PI*1.4;
        const sp  = Math.random()*2.4+0.8;
        particles.push({
          x:(x+0.5)*CELL, y:(row+0.5)*CELL,
          vx:Math.cos(ang)*sp, vy:-Math.abs(Math.sin(ang)*sp)-0.6,
          sz:Math.random()*2.4+0.5, color,
          born:performance.now(), life:480+Math.random()*280
        });
      }
    }
  }
  function drawParticles(now) {
    particles = particles.filter(p => now-p.born < p.life);
    for (const p of particles) {
      const t = (now-p.born)/p.life;
      p.x += p.vx; p.y += p.vy; p.vy += 0.07;
      ctx.globalAlpha = (1-t)*0.82;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.sz*(1-t*0.45), 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ─── Clear glow ───────────────────────────────────────────────────────────────
  function drawClearGlow(now) {
    if (!clearGlow || now > clearGlow.end) { clearGlow = null; return; }
    const t = (clearGlow.end-now)/380;
    ctx.globalAlpha = Math.sin(t*Math.PI)*0.48;
    for (const row of clearGlow.rows) {
      const g = ctx.createLinearGradient(0, row*CELL, canvas.width, row*CELL);
      g.addColorStop(0,'transparent');
      g.addColorStop(0.3, clearGlow.color);
      g.addColorStop(0.7, clearGlow.color);
      g.addColorStop(1,'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, row*CELL, canvas.width, CELL);
    }
    ctx.globalAlpha = 1;
  }

  // ─── Tilt hints (edge affordances) ───────────────────────────────────────────
  function drawTiltHints(now) {
    const isWindow  = tiltWindowOpen;
    const isPlaying = !gameOver && !animating && !roundPending && !!piece;
    if (!isPlaying && !isWindow) return;

    const baseA = isPlaying ? 0.10 : 0;
    const winA  = isWindow  ? (0.20 + 0.09*Math.sin(now/230)) : 0;
    const edgeA = baseA + winA;
    if (edgeA < 0.01) return;

    ctx.globalAlpha = edgeA;
    const gl = ctx.createLinearGradient(0,0,34,0);
    gl.addColorStop(0,'#00e5cc'); gl.addColorStop(1,'transparent');
    ctx.fillStyle = gl; ctx.fillRect(0, 0, 34, canvas.height);

    const gr = ctx.createLinearGradient(canvas.width,0,canvas.width-34,0);
    gr.addColorStop(0,'#00e5cc'); gr.addColorStop(1,'transparent');
    ctx.fillStyle = gr; ctx.fillRect(canvas.width-34, 0, 34, canvas.height);

    const chevA = Math.min(1, edgeA*2.8);
    ctx.globalAlpha = chevA;
    ctx.fillStyle = '#00e5cc';
    ctx.font = 'bold 15px sans-serif';
    const cy = (canvas.height/2+6)|0;
    ctx.textAlign = 'left';  ctx.fillText('‹', 7, cy);
    ctx.textAlign = 'right'; ctx.fillText('›', canvas.width-7, cy);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  // ─── Rendering ────────────────────────────────────────────────────────────────
  const BG   = '#07101f';
  const GRID = 'rgba(255,255,255,0.04)';

  function drawBlock(ctx2, px, py, sz, color, flash, isAnchor) {
    ctx2.fillStyle = BG;
    ctx2.fillRect(px, py, sz, sz);
    if (!color) {
      ctx2.strokeStyle = GRID; ctx2.lineWidth = 0.5;
      ctx2.strokeRect(px+0.5, py+0.5, sz-1, sz-1);
      return;
    }
    ctx2.fillStyle = flash ? '#ffffff' : color;
    ctx2.fillRect(px+2, py+2, sz-4, sz-4);
    if (!flash) {
      ctx2.fillStyle = 'rgba(255,255,255,0.18)'; ctx2.fillRect(px+2, py+2, sz-4, 4);
      ctx2.fillStyle = 'rgba(0,0,0,0.18)';       ctx2.fillRect(px+2, py+sz-6, sz-4, 4);
      if (isAnchor) {
        ctx2.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx2.lineWidth = 1.5;
        ctx2.strokeRect(px+5, py+5, sz-10, sz-10);
      }
    }
  }

  function renderNextPiece() {
    nctx.fillStyle = BG;
    nctx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!nextPiece) return;
    const shape = nextPiece.shape;
    let minR=3,maxR=0,minC=3,maxC=0;
    for (let r=0;r<4;r++) for (let c=0;c<4;c++) {
      if (shape[r][c]) { minR=Math.min(minR,r);maxR=Math.max(maxR,r);minC=Math.min(minC,c);maxC=Math.max(maxC,c); }
    }
    const bh=(maxR-minR+1)*NEXT_CELL, bw=(maxC-minC+1)*NEXT_CELL;
    const ox=Math.floor((nextCanvas.width-bw)/2), oy=Math.floor((nextCanvas.height-bh)/2);
    const isAnchor = nextPiece.color === anchorColor;
    for (let r=minR;r<=maxR;r++) for (let c=minC;c<=maxC;c++) {
      if (shape[r][c]) drawBlock(nctx,ox+(c-minC)*NEXT_CELL,oy+(r-minR)*NEXT_CELL,NEXT_CELL,nextPiece.color,false,isAnchor);
    }
  }

  function render(ts) {
    const now = performance.now();
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const flashSet  = (clearFlashRows && now < clearFlashEnd) ? new Set(clearFlashRows) : null;
    const lockFlash = now < lockFlashEnd;

    // Board
    for (let y=0;y<ROWS;y++) for (let x=0;x<COLS;x++) {
      const c = board[y][x];
      drawBlock(ctx, x*CELL, y*CELL, CELL, c, flashSet&&flashSet.has(y), c===anchorColor);
    }

    // Ghost + active piece
    if (!tiltWindowOpen && !animating && piece && !gameOver && !roundPending) {
      let gy = piece.y;
      while (!collides({...piece,y:gy+1}, board)) gy++;
      for (let r=0;r<4;r++) for (let c=0;c<4;c++) {
        if (!piece.shape[r][c]) continue;
        const gx=piece.x+c, gyr=gy+r;
        if (gyr>=0&&gyr<ROWS) {
          ctx.fillStyle='rgba(255,255,255,0.07)';
          ctx.fillRect(gx*CELL+2, gyr*CELL+2, CELL-4, CELL-4);
        }
      }
      const alpha = gravityPaused ? (0.62+0.38*Math.sin(now/190)) : 1;
      ctx.globalAlpha = alpha;
      for (let r=0;r<4;r++) for (let c=0;c<4;c++) {
        if (!piece.shape[r][c]) continue;
        const px2=piece.x+c, py2=piece.y+r;
        if (py2>=0) drawBlock(ctx, px2*CELL, py2*CELL, CELL, piece.color, lockFlash, piece.color===anchorColor);
      }
      ctx.globalAlpha = 1;
    }

    drawClearGlow(now);
    drawTiltHints(now);
    drawParticles(now);

    scoreEl.textContent = score;
  }

  // ─── Game over ────────────────────────────────────────────────────────────────
  function endGame() {
    gameOver = true;
    closeTiltWindow();
    goDetail.textContent = `Score ${score.toLocaleString()} · Lines ${lines} · Round ${round}`;
    const isNew = score > stats.bestScore;
    if (isNew) stats.bestScore = score;
    if (lines > stats.bestLines) stats.bestLines = lines;
    stats.totalRuns++;
    saveStats(stats);
    updateStatsBar();
    goBest.textContent = isNew ? '✦ New best score!' : `Best ${stats.bestScore.toLocaleString()}`;
    goOverlay.classList.remove('hidden');
    track('game_over', {score, lines, round, runs:stats.totalRuns});
  }

  function updateStatsBar() {
    statBest.textContent  = stats.bestScore.toLocaleString();
    statLines.textContent = stats.bestLines;
    statRuns.textContent  = stats.totalRuns;
  }

  // ─── Start / restart ──────────────────────────────────────────────────────────
  function startGame() {
    board      = emptyBoard();
    bag        = newBag();
    score      = 0; lines = 0; gameOver = false; animating = false;
    tiltWindowOpen = false; gravityPaused = false;
    roundPending   = false;
    clearTimeout(tiltWindowTimer); tiltWindowTimer = null;
    clearTimeout(roundTimer);      roundTimer = null;
    lockFlashEnd = 0; clearFlashEnd = 0; clearFlashRows = null;
    clearGlow = null; particles = [];
    turnCount = 0;
    goOverlay.classList.add('hidden');
    roundOverlay.classList.add('hidden');
    nextPiece = makePiece(fromBag());
    startRound(1);
    track('game_start', {runs:stats.totalRuns});
    initHint();
  }

  // ─── Device orientation ───────────────────────────────────────────────────────
  let orientationReady = false;
  function setupOrientation() {
    if (orientationReady) return;
    orientationReady = true;
    const listen = () => window.addEventListener('deviceorientation', handleOrientation, {passive:true});
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      DeviceOrientationEvent.requestPermission().then(r => { if (r==='granted') listen(); }).catch(()=>{});
    } else {
      listen();
    }
  }
  let tiltBase = null, tiltLatch = false;
  function handleOrientation(e) {
    if (animating || gameOver || roundPending) { tiltLatch=false; tiltBase=null; return; }
    const gamma = e.gamma||0;
    if (tiltBase === null) { tiltBase = gamma; return; }
    const delta = gamma - tiltBase;
    if (!tiltLatch) {
      if (delta < -20)     { tiltLatch=true; doTilt(-1); }
      else if (delta > 20) { tiltLatch=true; doTilt(+1); }
    }
    if (Math.abs(delta) < 6) { tiltLatch=false; tiltBase=null; }
  }

  // ─── Touch / pointer ──────────────────────────────────────────────────────────
  let touchOrigin = null, holdTimer = null, pointerDelta = 0;

  canvas.addEventListener('pointerdown', e => {
    touchOrigin  = {x:e.clientX, y:e.clientY, t:Date.now()};
    pointerDelta = 0;
    canvas.setPointerCapture(e.pointerId);
    setupOrientation();
    holdTimer = setTimeout(() => {
      if (pointerDelta < 8 && !gameOver && !tiltWindowOpen && !animating && !roundPending) {
        gravityPaused = true;
        if (navigator.vibrate) navigator.vibrate(10);
      }
    }, HOLD_MS);
  });

  canvas.addEventListener('pointermove', e => {
    if (!touchOrigin) return;
    const dx = e.clientX-touchOrigin.x, dy = e.clientY-touchOrigin.y;
    pointerDelta = Math.sqrt(dx*dx+dy*dy);
    if (pointerDelta > 8) { clearTimeout(holdTimer); holdTimer = null; }
  });

  canvas.addEventListener('pointerup', e => {
    clearTimeout(holdTimer); holdTimer = null;
    if (gravityPaused) {
      gravityPaused = false; lastFall = performance.now();
      touchOrigin = null; return;
    }
    if (!touchOrigin) return;
    const dx  = e.clientX - touchOrigin.x;
    const dy  = e.clientY - touchOrigin.y;
    const dt  = Date.now() - touchOrigin.t;
    const rect = canvas.getBoundingClientRect();
    const startRelX = touchOrigin.x - rect.left;
    touchOrigin = null;

    const edgePx    = rect.width * 0.15;
    const isEdge    = startRelX < edgePx || startRelX > rect.width - edgePx;
    const isHSwipe  = Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy)*1.1;

    if ((tiltWindowOpen || isEdge) && isHSwipe) { doTilt(dx<0?-1:1); return; }
    if (tiltWindowOpen) return;

    if (gameOver || animating || roundPending) return;
    if (pointerDelta < 10 && dt < 300) { tryRotate(); return; }
    if (Math.abs(dy) > 44 && dy > Math.abs(dx)*1.4) { hardDrop(); return; }
    if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy)*1.4) tryMove(dx<0?-1:1);
  });

  // ─── Button controls ──────────────────────────────────────────────────────────
  let moveTimer = null;
  const startRepeat = dx => { tryMove(dx); moveTimer = setInterval(()=>tryMove(dx), 108); };
  const stopRepeat  = ()  => { clearInterval(moveTimer); moveTimer = null; };

  document.getElementById('btn-left').addEventListener('pointerdown', ()=>startRepeat(-1));
  document.getElementById('btn-right').addEventListener('pointerdown', ()=>startRepeat(+1));
  document.addEventListener('pointerup', stopRepeat);
  document.getElementById('btn-rotate').addEventListener('click', tryRotate);
  document.getElementById('btn-drop').addEventListener('click', hardDrop);
  document.getElementById('btn-replay').addEventListener('click', () => { track('restart',{}); startGame(); });

  // ─── Menu ─────────────────────────────────────────────────────────────────────
  document.getElementById('btn-menu').addEventListener('click', e => {
    e.stopPropagation();
    menuDropdown.classList.toggle('open');
  });
  document.addEventListener('pointerdown', () => menuDropdown.classList.remove('open'));

  // ─── Game loop ────────────────────────────────────────────────────────────────
  function loop(ts) {
    if (gravityPaused) lastFall = ts;
    if (!gameOver && !tiltWindowOpen && !animating && !gravityPaused && !roundPending) autoFall(ts);
    render(ts);
    renderNextPiece();
    requestAnimationFrame(loop);
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  updateStatsBar();
  startGame();
  requestAnimationFrame(loop);

})();
