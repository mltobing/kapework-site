/* engine.js — NameForge deterministic naming engine
 *
 * Works with zero AI. Takes a StructuredBrief and returns clustered name results.
 *
 * Pipeline:
 *   1. Expand brief → keyword pools
 *   2. Apply naming patterns → candidate list
 *   3. Filter banned words / near-duplicates
 *   4. Score each candidate (brevity, pronounceability, lane fit, vibe fit)
 *   5. Cluster into named groups
 *   6. Generate tagline + rationale per name
 *
 * Public API:
 *   NameForgeEngine.generate(brief, feedbackWeights?) → ResultSet
 *   NameForgeEngine.refine(resultSet, reactions)     → ResultSet
 */

'use strict';

(function () {

  // ─── Word banks ───────────────────────────────────────────────────────────

  const VERBS = [
    'build','make','forge','craft','shape','cast','cut','run','launch','track',
    'scan','map','trace','snap','clip','log','sort','mark','flow','push','pull',
    'shift','blend','merge','pack','strip','trim','plot','draft','sketch','burn',
    'fold','split','crunch','stack','pick','tap','leap','dash','glide','spark',
    'pulse','print','stamp','drop','link','wrap','loop','roll','spin','turn',
    'glow','flash','shine','show','view','read','write','find','seek','hunt',
  ];

  const NOUNS_TOOL = [
    'kit','lab','hub','set','box','bay','pad','den','pen','pod','bin','base',
    'core','grid','beam','deck','rack','bank','cell','node','port','gate','key',
    'lens','mark','note','line','file','log','map','list','board','stack','shelf',
    'desk','bench','vault','forge','works','yard','shop','mill','press','frame',
    'field','zone','band','ring','link','chain','mesh','web','net','wire','pipe',
  ];

  const NOUNS_GAME = [
    'quest','run','dash','leap','roll','race','hunt','chase','trial','round',
    'clash','bout','duel','match','rally','drive','blitz','surge','burst','rush',
    'wave','storm','blaze','spark','strike','shift','flip','spin','twist','drop',
    'block','path','maze','trail','grid','board','field','arena','stage','realm',
    'world','land','isle','peak','ridge','vale','fort','tower','bridge','vault',
  ];

  const NOUNS_APP = [
    'app','tool','helper','widget','agent','bot','scout','pilot','guide','coach',
    'mirror','lens','scope','glass','prism','bridge','relay','pulse','beacon',
    'signal','trace','pin','tag','flag','mark','stamp','clip','snap','shot',
    'digest','brief','draft','sketch','print','frame','cast','stream','feed',
    'flow','queue','batch','task','run','pass','check','score','rank','rate',
  ];

  const TONE_WORDS = {
    clear:     ['clear','plain','direct','simple','clean','open','bright','sharp','true','right'],
    clever:    ['smart','neat','slick','keen','quick','apt','sly','wit','ace','deft'],
    minimal:   ['lean','bare','pure','light','thin','trim','stark','spare','void','zen'],
    playful:   ['fun','pop','zap','zip','whiz','zoom','ping','zing','zest','buzz'],
    premium:   ['prime','apex','peak','crest','crown','mark','gold','iron','steel','flint'],
    warm:      ['warm','kind','safe','cozy','soft','calm','mild','easy','fair','open'],
    surprising:['shift','flip','twist','turn','odd','rare','wild','bold','edge','leap'],
    serious:   ['core','solid','firm','true','clear','deep','strong','steady','sound','sure'],
    educational:['learn','read','grow','know','see','find','guide','teach','show','path'],
    cozy:      ['cozy','snug','home','nest','nook','den','hearth','mellow','gentle','quiet'],
  };

  const SUFFIXES = [
    'ly','ify','io','it','er','or','al','en','ful','less',
    'ish','ward','wise','ling','let','ette','kin','some','fold','side',
  ];

  const SUFFIX_WORDS = [
    'forge','lab','kit','works','hub','flow','mark','track','lens','map',
    'cast','note','log','pad','base','core','set','deck','box','press',
    'yard','bay','bench','craft','desk','grid','line','link','port','pulse',
  ];

  const PREFIX_WORDS = [
    'meta','ultra','super','micro','mini','macro','nano','omni','poly','multi',
    'swift','smart','clear','true','pure','prime','fresh','open','free','one',
    'your','my','the','pro','go','re','de','un','co','up',
  ];

  const BLEND_SEEDS = [
    'spark','flash','shift','craft','forge','frame','blend','print','snap','cast',
    'drift','glide','pulse','trace','scope','scout','brush','burst','bloom','grind',
    'shrink','launch','patch','parse','chunk','stack','slice','pack','trim','scan',
  ];

  // ─── Naming pattern definitions ───────────────────────────────────────────

  const PATTERNS = {
    // Clear & Direct
    direct_verb_noun:   { cluster:'clear',     weight:1.0 },
    direct_noun:        { cluster:'clear',     weight:0.9 },
    // Clever & Compact
    compound:           { cluster:'clever',    weight:1.0 },
    blend:              { cluster:'clever',    weight:0.9 },
    clipped:            { cluster:'clever',    weight:0.8 },
    // Brandable & Minimal
    suffix_word:        { cluster:'brandable', weight:1.0 },
    prefix_word:        { cluster:'brandable', weight:0.9 },
    abstract_single:    { cluster:'brandable', weight:0.8 },
    // Warm & Playful
    playful_rhyme:      { cluster:'playful',   weight:1.0 },
    playful_double:     { cluster:'playful',   weight:0.9 },
    // Premium & Polished
    premium_compound:   { cluster:'premium',   weight:1.0 },
    premium_minimal:    { cluster:'premium',   weight:0.9 },
  };

  // ─── Tagline templates ────────────────────────────────────────────────────

  const TAGLINE_TEMPLATES = [
    '{vibe} {format_type} for {audience}',
    '{verb} {product_type}, faster',
    'The {vibe} way to {verb} {product_type}',
    'Built for {audience}',
    '{verb} your next {format_type}',
    'Simple {product_type} tools for {audience}',
    'Where {product_type} takes shape',
    '{vibe}. Built for {audience}',
    'Less fuss, more {verb}',
    '{product_type} for people who {verb}',
  ];

  // ─── Utilities ────────────────────────────────────────────────────────────

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function titleCase(s) {
    return s.split(/\s+/).map(capitalize).join(' ');
  }

  // Count syllables (rough heuristic)
  function syllableCount(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  // Rough pronounceability: penalize 3+ consonants in a row
  function pronounceabilityScore(word) {
    const lower = word.toLowerCase();
    const consecutiveConsonants = (lower.match(/[^aeiouy]{3,}/g) || []).length;
    return Math.max(0, 1 - consecutiveConsonants * 0.25);
  }

  // Levenshtein distance for near-duplicate detection
  function levenshtein(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i-1] === b[j-1]
          ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  function isTooSimilar(name, existing) {
    const nl = name.toLowerCase();
    return existing.some(e => {
      const el = e.toLowerCase();
      if (nl === el) return true;
      if (nl.includes(el) || el.includes(nl)) return true;
      return levenshtein(nl, el) <= 2;
    });
  }

  function containsBanned(name, avoidWords) {
    if (!avoidWords || !avoidWords.length) return false;
    const nl = name.toLowerCase();
    return avoidWords.some(w => w && nl.includes(w.toLowerCase().trim()));
  }

  function pickRandom(arr, rng) {
    return arr[Math.floor(rng() * arr.length)];
  }

  // Seeded pseudo-random (simple but deterministic per brief)
  function makeRng(seed) {
    let s = seed | 0;
    return function () {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 4294967296;
    };
  }

  function briefSeed(brief) {
    const str = [
      brief.product_summary || '',
      brief.audience || '',
      brief.naming_lane || '',
      (brief.desired_vibes || []).join(','),
    ].join('|');
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) & 0xffffffff;
    }
    return h >>> 0;
  }

  // ─── Keyword expansion ────────────────────────────────────────────────────

  function expandBrief(brief) {
    const words = [];

    // Extract nouns from product summary
    const summary = (brief.product_summary || '').toLowerCase();
    const tokens = summary.split(/\W+/).filter(t => t.length >= 4);
    words.push(...tokens.slice(0, 6));

    // Core words from brief
    if (brief.core_words) {
      const cw = Array.isArray(brief.core_words)
        ? brief.core_words
        : String(brief.core_words).split(/[,\s]+/);
      words.push(...cw.map(w => w.toLowerCase().trim()).filter(w => w.length >= 3));
    }

    // Audience nouns
    const audience = (brief.audience || '').toLowerCase().split(/\W+/).filter(t => t.length >= 4);
    words.push(...audience.slice(0, 3));

    // Format-specific nouns
    const ft = (brief.format_type || brief.product_type || '').toLowerCase();
    if (ft.includes('game')) words.push(...pickN(NOUNS_GAME, 8, makeRng(1)));
    else if (ft.includes('app')) words.push(...pickN(NOUNS_APP, 8, makeRng(2)));
    else words.push(...pickN(NOUNS_TOOL, 8, makeRng(3)));

    // Vibe tone words
    const vibes = brief.desired_vibes || [];
    vibes.forEach(v => {
      const tw = TONE_WORDS[v.toLowerCase()];
      if (tw) words.push(...tw.slice(0, 3));
    });

    // Blend seeds always included
    words.push(...pickN(BLEND_SEEDS, 12, makeRng(briefSeed(brief))));

    // Unique, min length 3
    return [...new Set(words)].filter(w => w.length >= 3);
  }

  function pickN(arr, n, rng) {
    const copy = arr.slice();
    const result = [];
    for (let i = 0; i < n && copy.length; i++) {
      const idx = Math.floor(rng() * copy.length);
      result.push(copy.splice(idx, 1)[0]);
    }
    return result;
  }

  // ─── Candidate generation per pattern ────────────────────────────────────

  function generateCandidates(brief, pool, rng) {
    const candidates = [];
    const lane = (brief.naming_lane || 'clever').toLowerCase();
    const ft = (brief.format_type || brief.product_type || 'tool').toLowerCase();

    const domainNouns = ft.includes('game') ? NOUNS_GAME
      : ft.includes('app') ? NOUNS_APP : NOUNS_TOOL;

    // direct_verb_noun
    for (let i = 0; i < 12; i++) {
      const v = pickRandom(VERBS, rng);
      const n = pickRandom(pool.length ? pool : domainNouns, rng);
      candidates.push({ name: capitalize(v) + capitalize(n), pattern: 'direct_verb_noun' });
    }

    // direct_noun
    for (let i = 0; i < 8; i++) {
      const n = pickRandom(domainNouns, rng);
      const t = pickRandom(pool.length ? pool : NOUNS_TOOL, rng);
      candidates.push({ name: capitalize(t) + capitalize(n), pattern: 'direct_noun' });
    }

    // compound (two pool words)
    for (let i = 0; i < 14; i++) {
      const a = pickRandom(pool.length >= 2 ? pool : BLEND_SEEDS, rng);
      const b = pickRandom(domainNouns, rng);
      if (a !== b) {
        candidates.push({ name: capitalize(a) + capitalize(b), pattern: 'compound' });
      }
    }

    // blend (truncated compound)
    for (let i = 0; i < 10; i++) {
      const a = pickRandom(BLEND_SEEDS, rng);
      const b = pickRandom(pool.length ? pool : BLEND_SEEDS, rng);
      if (a !== b && a.length >= 4 && b.length >= 4) {
        const half = Math.ceil(a.length / 2);
        const blended = capitalize(a.slice(0, half)) + b.slice(Math.floor(b.length / 2));
        if (blended.length >= 4) {
          candidates.push({ name: blended, pattern: 'blend' });
        }
      }
    }

    // clipped (pool word shortened + suffix letter)
    for (let i = 0; i < 8; i++) {
      const w = pickRandom(pool.length ? pool : BLEND_SEEDS, rng);
      if (w.length >= 5) {
        const clipped = w.slice(0, Math.ceil(w.length * 0.7));
        candidates.push({ name: capitalize(clipped) + 'r', pattern: 'clipped' });
        candidates.push({ name: capitalize(clipped) + 'ly', pattern: 'clipped' });
      }
    }

    // suffix_word (pool word + suffix-word)
    for (let i = 0; i < 14; i++) {
      const base = pickRandom(pool.length ? pool : BLEND_SEEDS, rng);
      const suf = pickRandom(SUFFIX_WORDS, rng);
      candidates.push({ name: capitalize(base) + capitalize(suf), pattern: 'suffix_word' });
    }

    // prefix_word (prefix + pool word)
    for (let i = 0; i < 10; i++) {
      const pre = pickRandom(PREFIX_WORDS, rng);
      const base = pickRandom(pool.length ? pool : NOUNS_TOOL, rng);
      candidates.push({ name: capitalize(pre) + capitalize(base), pattern: 'prefix_word' });
    }

    // abstract_single (pool word as-is, or slightly modified)
    for (let i = 0; i < 8; i++) {
      const w = pickRandom(BLEND_SEEDS, rng);
      candidates.push({ name: capitalize(w), pattern: 'abstract_single' });
    }

    // playful_rhyme (AA or near-rhyme construction)
    for (let i = 0; i < 6; i++) {
      const v = pickRandom(VERBS.filter(x => x.length <= 5), rng);
      const suf = pickRandom(SUFFIXES, rng);
      candidates.push({ name: capitalize(v) + suf, pattern: 'playful_rhyme' });
    }

    // playful_double (repeated syllable feel)
    for (let i = 0; i < 6; i++) {
      const w = pickRandom(pool.length ? pool : BLEND_SEEDS, rng);
      if (w.length >= 3) {
        const bit = w.slice(0, 3);
        candidates.push({ name: capitalize(bit) + bit + 'y', pattern: 'playful_double' });
      }
    }

    // premium_compound (tone word + domain noun)
    for (let i = 0; i < 10; i++) {
      const vibes = brief.desired_vibes || ['premium'];
      const toneBank = TONE_WORDS[(vibes[0] || 'premium').toLowerCase()] || TONE_WORDS.premium;
      const tw = pickRandom(toneBank, rng);
      const dn = pickRandom(domainNouns, rng);
      candidates.push({ name: capitalize(tw) + capitalize(dn), pattern: 'premium_compound' });
    }

    // premium_minimal (single polished word from tone bank)
    for (let i = 0; i < 8; i++) {
      const vibes = brief.desired_vibes || ['premium'];
      const toneBank = TONE_WORDS[(vibes[0] || 'premium').toLowerCase()] || TONE_WORDS.premium;
      const tw = pickRandom(toneBank, rng);
      const dn = pickRandom(NOUNS_TOOL, rng);
      candidates.push({ name: capitalize(tw) + capitalize(dn), pattern: 'premium_minimal' });
    }

    return candidates;
  }

  // ─── Scoring ──────────────────────────────────────────────────────────────

  const LANE_PATTERN_AFFINITY = {
    clear:     ['direct_verb_noun','direct_noun'],
    clever:    ['compound','blend','clipped'],
    brandable: ['suffix_word','prefix_word','abstract_single'],
    playful:   ['playful_rhyme','playful_double','blend'],
    premium:   ['premium_compound','premium_minimal','abstract_single'],
  };

  function scoreCandidate(candidate, brief, feedbackWeights) {
    const { name, pattern } = candidate;
    const words = name.toLowerCase();
    let score = 0.5;

    // Brevity (ideal: 1–3 syllables)
    const syls = syllableCount(name);
    if (syls <= 2) score += 0.20;
    else if (syls === 3) score += 0.10;
    else if (syls >= 5) score -= 0.15;

    // Length penalty for very long names
    if (name.length > 12) score -= 0.10;
    if (name.length > 16) score -= 0.15;
    if (name.length < 4)  score -= 0.20;

    // Pronounceability
    score += pronounceabilityScore(name) * 0.15;

    // Lane fit
    const lane = (brief.naming_lane || 'clever').toLowerCase();
    const affinityPatterns = LANE_PATTERN_AFFINITY[lane] || [];
    if (affinityPatterns.includes(pattern)) score += 0.20;

    // Vibe fit: check if vibe tone words appear in the name
    const vibes = brief.desired_vibes || [];
    vibes.forEach(v => {
      const tw = TONE_WORDS[v.toLowerCase()];
      if (tw && tw.some(w => words.includes(w))) score += 0.08;
    });

    // Starts with a capital and looks like a real word
    if (/^[A-Z][a-z]/.test(name)) score += 0.05;

    // Avoid overly generic suffixes only if in premium lane
    if (lane === 'premium' && /(?:App|Tool|Helper)$/i.test(name)) score -= 0.10;

    // Pattern weight
    const patternDef = PATTERNS[pattern];
    if (patternDef) score *= patternDef.weight;

    // Feedback weights adjustment
    if (feedbackWeights) {
      const clusterKey = patternDef ? patternDef.cluster : null;
      if (clusterKey && feedbackWeights[clusterKey]) {
        score *= feedbackWeights[clusterKey];
      }
      if (feedbackWeights[pattern]) {
        score *= feedbackWeights[pattern];
      }
    }

    return Math.max(0, Math.min(1, score));
  }

  // ─── Tagline generator ────────────────────────────────────────────────────

  function generateTagline(brief, rng) {
    const template = pickRandom(TAGLINE_TEMPLATES, rng);
    const vibe = ((brief.desired_vibes || [])[0] || 'simple');
    const verb = pickRandom(VERBS.slice(0, 20), rng);
    const audience = brief.audience || 'builders';
    const formatType = brief.format_type || brief.product_type || 'tool';
    const productType = brief.product_summary
      ? brief.product_summary.split(/\s+/).slice(0, 3).join(' ')
      : formatType;

    return template
      .replace('{vibe}', capitalize(vibe))
      .replace('{format_type}', formatType)
      .replace('{audience}', audience)
      .replace('{verb}', verb)
      .replace('{product_type}', productType);
  }

  // ─── Rationale generator ─────────────────────────────────────────────────

  const RATIONALE_TEMPLATES = {
    clear:     ['Direct and legible — says what it does.', 'No ambiguity. Builders get it immediately.', 'Clean and functional.'],
    clever:    ['A compact compound that earns its cleverness.', 'Blends meaning efficiently.', 'Neat and memorable.'],
    brandable: ['Works as a standalone brand word.', 'Distinctive enough to own.', 'Minimal — sticks in memory.'],
    playful:   ['Has energy without being childish.', 'Fun to say. Stays in mind.', 'Light touch, real personality.'],
    premium:   ['Polished and confident.', 'Premium feel without pretension.', 'Feels considered.'],
  };

  function generateRationale(cluster, brief, rng) {
    const pool = RATIONALE_TEMPLATES[cluster] || RATIONALE_TEMPLATES.clever;
    return pickRandom(pool, rng);
  }

  // ─── Tags generator ──────────────────────────────────────────────────────

  const CLUSTER_TAGS = {
    clear:     ['clear','direct','legible'],
    clever:    ['clever','compact','blended'],
    brandable: ['brandable','minimal','ownable'],
    playful:   ['playful','energetic','memorable'],
    premium:   ['premium','polished','confident'],
  };

  function tagsForResult(cluster, brief) {
    const base = (CLUSTER_TAGS[cluster] || ['clear']).slice(0, 2);
    const vibes = brief.desired_vibes || [];
    if (vibes.length) base.push(vibes[0]);
    return [...new Set(base)].slice(0, 3);
  }

  // ─── Cluster labels ───────────────────────────────────────────────────────

  const CLUSTER_LABELS = {
    clear:     'Clear & Direct',
    clever:    'Clever & Compact',
    brandable: 'Brandable & Minimal',
    playful:   'Warm & Playful',
    premium:   'Premium & Polished',
  };

  // ─── Main generation function ─────────────────────────────────────────────

  function generate(brief, feedbackWeights) {
    const rng = makeRng(briefSeed(brief));
    const pool = expandBrief(brief);
    const avoidWords = Array.isArray(brief.avoid_words)
      ? brief.avoid_words
      : String(brief.avoid_words || '').split(/[,\s]+/).filter(Boolean);

    // Generate raw candidates
    let candidates = generateCandidates(brief, pool, rng);

    // Filter
    const seen = [];
    candidates = candidates.filter(c => {
      if (containsBanned(c.name, avoidWords)) return false;
      if (isTooSimilar(c.name, seen)) return false;
      seen.push(c.name);
      return true;
    });

    // Score
    candidates = candidates.map(c => ({
      ...c,
      score: scoreCandidate(c, brief, feedbackWeights),
    }));

    // Sort descending
    candidates.sort((a, b) => b.score - a.score);

    // Take top 60, ensure variety of first letters
    const topSeen = new Set();
    const diverse = [];
    for (const c of candidates) {
      const fl = c.name[0].toUpperCase();
      if (!topSeen.has(fl) || diverse.length < 30) {
        diverse.push(c);
        topSeen.add(fl);
      }
      if (diverse.length >= 60) break;
    }

    // Assign taglines and rationale per candidate
    const taglineRng = makeRng(briefSeed(brief) ^ 0xdeadbeef);
    const enriched = diverse.map(c => {
      const patternDef = PATTERNS[c.pattern] || { cluster: 'clever' };
      const cluster = patternDef.cluster;
      return {
        name: c.name,
        pattern: c.pattern,
        cluster,
        score: c.score,
        tagline: generateTagline(brief, taglineRng),
        rationale: generateRationale(cluster, brief, taglineRng),
        tags: tagsForResult(cluster, brief),
      };
    });

    // Group into clusters — top N per cluster
    const PER_CLUSTER = 6;
    const clusterMap = {};
    for (const key of Object.keys(CLUSTER_LABELS)) clusterMap[key] = [];

    for (const r of enriched) {
      const bucket = clusterMap[r.cluster];
      if (bucket && bucket.length < PER_CLUSTER) bucket.push(r);
    }

    // Only return clusters that have results
    const clusters = Object.entries(clusterMap)
      .filter(([, items]) => items.length > 0)
      .map(([key, items]) => ({
        key,
        label: CLUSTER_LABELS[key],
        items,
      }));

    return {
      clusters,
      brief,
      feedbackWeights: feedbackWeights || {},
      generatedAt: Date.now(),
    };
  }

  // ─── Refine from reactions ────────────────────────────────────────────────

  /*
   * reactions: array of { name, reaction }
   * reaction: 'more_like_this' | 'less_like_this' | 'too_generic' | 'too_cute' | 'too_abstract'
   *
   * Returns updated feedbackWeights to pass into the next generate() call.
   */
  function buildFeedbackWeights(resultSet, reactions) {
    const weights = Object.assign({}, resultSet.feedbackWeights || {});

    // Find cluster for each reacted name
    const nameToCluster = {};
    for (const cluster of resultSet.clusters) {
      for (const item of cluster.items) {
        nameToCluster[item.name] = item.cluster;
      }
    }

    for (const { name, reaction } of reactions) {
      const cluster = nameToCluster[name];
      if (!cluster) continue;

      switch (reaction) {
        case 'more_like_this':
          weights[cluster] = (weights[cluster] || 1.0) * 1.35;
          break;
        case 'less_like_this':
          weights[cluster] = (weights[cluster] || 1.0) * 0.55;
          break;
        case 'too_generic':
          weights['clear'] = (weights['clear'] || 1.0) * 0.65;
          weights['clever'] = (weights['clever'] || 1.0) * 1.20;
          break;
        case 'too_cute':
          weights['playful'] = (weights['playful'] || 1.0) * 0.60;
          weights['premium'] = (weights['premium'] || 1.0) * 1.20;
          break;
        case 'too_abstract':
          weights['brandable'] = (weights['brandable'] || 1.0) * 0.60;
          weights['clear'] = (weights['clear'] || 1.0) * 1.25;
          break;
      }
    }

    return weights;
  }

  function refine(resultSet, reactions) {
    const weights = buildFeedbackWeights(resultSet, reactions);
    return generate(resultSet.brief, weights);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  window.NameForgeEngine = { generate, refine, CLUSTER_LABELS };

}());
