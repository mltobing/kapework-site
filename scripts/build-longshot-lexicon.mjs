#!/usr/bin/env node
/**
 * build-longshot-lexicon.mjs
 *
 * Builds a trust-first common-words.txt for Longshot by:
 *   1. Starting from the existing base word list
 *   2. Adding a hand-curated set of common English words that are missing
 *   3. Removing known obscure, archaic, or overly specialist words
 *   4. Writing the deduplicated, sorted result back to common-words.txt
 *
 * Usage:
 *   node scripts/build-longshot-lexicon.mjs
 *
 * Philosophy: better to accept an unusual but valid English word than to
 * reject a common word that any speaker would know. The path must still be
 * traced on the board, so false positives require both a lexicon hit AND
 * a traceable adjacency path — an unlikely coincidence.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '..');
const WORDS_FILE = join(REPO_ROOT, 'apps/longshot/data/common-words.txt');

// ── Load existing word list ────────────────────────────────────────────────────
function loadWords(file) {
  const raw = readFileSync(file, 'utf8');
  const out = new Set();
  for (const line of raw.split('\n')) {
    const w = line.trim().toLowerCase();
    if (w.length >= 5 && /^[a-z]+$/.test(w)) out.add(w);
  }
  return out;
}

// ── Curated additions ─────────────────────────────────────────────────────────
// Common English words that are clearly well-known but were missing from the
// base list. Grouped by category for maintainability.
const ADDITIONS = [
  // ── Common -ating/-eting/-iting words (verbs + nouns) ─────────────────────
  'rating', 'ratings', 'rated', 'rater',
  'treating', 'treated', 'treater',
  'coating', 'coated', 'coater', 'coats',
  'floating', 'floated', 'floater', 'floats',
  'grating', 'grated', 'grater', 'grates',
  'stating', 'stated', 'stater', 'states',
  'plating', 'plated', 'plater', 'plates',
  'skating', 'skated', 'skater', 'skates',
  'creating', 'created', 'creator', 'creates',
  'locating', 'located', 'locates', 'locate',
  'rotating', 'rotated', 'rotates', 'rotate',
  'relating', 'related', 'relates', 'relate',
  'donating', 'donated', 'donates', 'donate',
  'debating', 'debated', 'debates', 'debate',
  'elating', 'elated', 'elates', 'elate',
  'granting', 'granted',
  'slating', 'slated', 'slater', 'slates',
  'crating', 'crated', 'crates',
  'boating', 'boated', 'boater',
  'noting', 'noted', 'noter', 'notes',
  'voting', 'voted', 'voter', 'votes',
  'doting', 'doted', 'doter', 'dotes',
  'toting', 'toted', 'toter', 'totes',
  'quoting', 'quoted', 'quoter', 'quotes',
  'gratin', 'greats',

  // ── Common -tion / -ation words ───────────────────────────────────────────
  'nation', 'nations',
  'ration', 'rations', 'rationed',
  'motion', 'motions', 'motioned',
  'notion', 'notions',
  'lotion', 'lotions',
  'potion', 'potions',
  'option', 'options',
  'action', 'actions',
  'traction', 'fraction', 'fractions',
  'mention', 'mentions', 'mentioned',
  'tension', 'tensions',
  'pension', 'pensions', 'pensioned',
  'mission', 'missions',
  'vision', 'visions',
  'fiction',
  'diction',
  'function', 'functions', 'functioned',
  'junction', 'junctions',
  'suction',
  'location', 'locations',
  'creation', 'creations',
  'relation', 'relations',
  'rotation', 'rotations',
  'donation', 'donations',
  'negation',
  'elation',
  'inflation',
  'deflation',
  'narration',
  'operation', 'operations',
  'generation', 'generations',

  // ── Common verbs: base + inflections ──────────────────────────────────────
  'greet', 'greets', 'greeted', 'greeter', 'greeting', 'greetings',
  'treat', 'treats',
  'locate', 'locates', 'located',
  'rotate', 'rotates', 'rotated',
  'create', 'creates', 'created',
  'relate', 'relates', 'related',
  'donate', 'donates', 'donated',
  'debate', 'debates', 'debated',
  'elate', 'elates', 'elated',
  'inflate', 'inflates', 'inflated',
  'deflate', 'deflates', 'deflated',
  'narrate', 'narrates', 'narrated',

  // ── Common -er agent nouns ─────────────────────────────────────────────────
  'rocket', 'rockets',
  'socket', 'sockets',
  'locket', 'lockets',
  'pocket', 'pockets', 'pocketed',
  'docket', 'dockets',
  'locker', 'lockers',
  'rocker', 'rockers',
  'stoker', 'stokers',
  'broker', 'brokers', 'brokered',
  'smoker', 'smokers',
  'joker', 'jokers',
  'choker', 'chokers',
  'poker', 'pokers',
  'token', 'tokens',
  'spoken',
  'broken',
  'stolen',
  'frozen',
  'woken', 'awoken',
  'chosen',
  'crater', 'craters',
  'grater', 'graters',
  'skater', 'skaters',
  'plater', 'platers',
  'stater',
  'coater',
  'floater', 'floaters',

  // ── Common -ing present participles ───────────────────────────────────────
  'staking', 'taking', 'making', 'baking', 'faking', 'raking', 'waking',
  'shaking', 'braking', 'flaking', 'snaking',
  'stoning', 'toning', 'boning', 'honing', 'cloning', 'zoning',
  'storing', 'boring', 'coring', 'soaring', 'roaring', 'pouring',
  'stoked', 'stoking', 'smoking', 'joking', 'poking', 'choking',
  'soaking', 'cloaking', 'croaking',
  'keeping', 'sleeping', 'sweeping', 'creeping', 'seeping',
  'reaping', 'leaping', 'heaping',
  'trading', 'grading', 'shading', 'wading', 'fading', 'raiding',
  'sliding', 'gliding', 'riding', 'hiding', 'siding',
  'stoning', 'honing', 'zoning', 'toning',
  'chasing', 'racing', 'pacing', 'lacing', 'facing', 'placing',
  'tracing', 'bracing', 'gracing', 'spacing',
  'changing', 'ranging', 'hanging', 'banging', 'ganging', 'clanging',
  'ringing', 'singing', 'clinging', 'slinging', 'stinging', 'bringing',
  'swinging', 'winging', 'flinging', 'wringing',
  'standing', 'landing', 'handing', 'banding', 'sanding', 'branding',
  'stranding', 'expanding', 'commanding', 'demanding', 'understanding',
  'sending', 'bending', 'lending', 'fending', 'mending', 'rending',
  'tending', 'vending', 'ending', 'blending', 'spending',
  'pending', 'fending',

  // ── -aring / -airing / -aining words ──────────────────────────────────────
  'staring', 'stared', 'starer',
  'glaring', 'glared', 'glarer',
  'sparing', 'spared', 'sparer',
  'bearing', 'beared',
  'tearing', 'teared',
  'fearing', 'feared',
  'nearing', 'neared',
  'rearing', 'reared',
  'searing', 'seared',
  'paring', 'pared',
  'raring',
  'caring', 'cared',
  'baring', 'bared',
  'flaring', 'flared',
  'snaring', 'snared',
  'starring', 'starred',
  'training', 'trained', 'trainer', 'trainees',
  'draining', 'drained', 'drainer',
  'straining', 'strained', 'strainer',
  'reigning', 'reigned',
  'gaining', 'gained', 'gainer',
  'raining', 'rained',
  'paining', 'pained',
  'staining', 'stained', 'stainer',
  'chaining', 'chained',
  'attaining', 'attained',
  'obtaining', 'obtained',
  'containing', 'contained',
  'explaining', 'explained',
  'complaining', 'complained',
  'remaining', 'remained',
  'sustaining', 'sustained',
  'maintaining', 'maintained',

  // ── -ain, -rain, -grain, -train nouns/verbs ────────────────────────────────
  'grains', 'trains', 'drains', 'brains', 'strains', 'chains',
  'pains', 'rains', 'stains', 'plains', 'swains', 'veins', 'reins',
  'grain', 'train', 'drain', 'brain', 'strain', 'chain',
  'plain', 'reign', 'vein', 'rein', 'swain',

  // ── Common -tion/-sion that may be missing ─────────────────────────────────
  'station', 'stations',
  'creation', 'creations',
  'ration', 'rations',

  // ── More common verbs + inflections ───────────────────────────────────────
  'stare', 'stares',
  'glare', 'glares',
  'spare', 'spares',
  'flare', 'flares',
  'snare', 'snares',
  'train', 'trains',
  'drain', 'drains',
  'strain', 'strains',
  'gain', 'gains',
  'stain', 'stains',
  'chain', 'chains',
  'plain', 'plains',
  'paint', 'paints', 'painted', 'painter', 'painting',
  'faint', 'faints', 'fainted', 'fainting',
  'taint', 'taints', 'tainted', 'tainting',
  'saint', 'saints',
  'point', 'points', 'pointed', 'pointer', 'pointing',
  'joint', 'joints', 'jointed',
  'print', 'prints', 'printed', 'printer', 'printing',
  'grant', 'grants', 'granted', 'granting',
  'plant', 'plants', 'planted', 'planter', 'planting',
  'slant', 'slants', 'slanted',
  'chant', 'chants', 'chanted', 'chanting',
  'scant',
  'rant', 'rants', 'ranted', 'ranting',
  'pant', 'pants', 'panted', 'panting',
  'spent', 'sprent',
  'dent', 'dents', 'dented', 'denting',
  'tent', 'tents', 'tented',
  'rent', 'rents', 'rented', 'renting',
  'went', 'scent', 'scents', 'scented',
  'meant', 'meant',
  'blend', 'blends', 'blended', 'blending',
  'trend', 'trends', 'trended', 'trending',

  // ── Common nouns plural that may be missing ────────────────────────────────
  'grains', 'trains', 'strains',
  'stores', 'shores', 'scores', 'bores', 'cores', 'pores',
  'tones', 'bones', 'zones', 'cones', 'hones', 'clones',
  'notes', 'votes', 'dotes', 'totes', 'quotes',
  'rates', 'mates', 'dates', 'fates', 'gates', 'hates', 'lates',
  'plates', 'slates', 'states', 'crates', 'grates', 'skates',
  'coats', 'boats', 'goats', 'moats', 'bloats', 'floats', 'gloats',

  // ── Comparative / superlative adjectives ──────────────────────────────────
  'greater', 'greatest',
  'straighter', 'straightest',
  'later', 'latest',
  'greater', 'nearest', 'dearest', 'clearest', 'nearest',
  'older', 'oldest', 'colder', 'coldest', 'bolder', 'boldest',
  'wider', 'widest', 'rider', 'finest',
  'grander', 'grandest',
  'longer', 'longest', 'stronger', 'strongest',
  'higher', 'highest', 'lower', 'lowest',
  'inner', 'outer', 'under', 'other',

  // ── Common past tense forms ───────────────────────────────────────────────
  'coated', 'floated', 'grated', 'stated', 'plated', 'skated',
  'rotted', 'knotted', 'plotted', 'dotted', 'blotted', 'trotted',
  'toasted', 'boasted', 'roasted', 'coasted',
  'listed', 'misted', 'twisted',
  'lasted', 'basted', 'pasted', 'tasted', 'wasted',
  'nested', 'rested', 'tested', 'bested', 'crested', 'vested',
  'jested', 'zested',
  'stoked', 'choked', 'soaked', 'cloaked',
  'blotted', 'knotted', 'slotted', 'plotted', 'trotted',

  // ── Common 5-letter words that fill obvious gaps ───────────────────────────
  'trice', 'twice',
  'stoke', 'smoke', 'spoke', 'broke', 'woken', 'token',
  'chore', 'snore', 'adore',
  'trope', 'grope', 'scope', 'slope',
  'grind', 'bring', 'fling', 'cling', 'sling', 'sting',
  'swing', 'wring', 'thing',
  'drink', 'brink', 'blink', 'clink', 'slink', 'stink', 'think',
  'crack', 'black', 'slack', 'stack', 'smack', 'snack',
  'trick', 'brick', 'click', 'flick', 'slick', 'stick', 'thick',
  'tread', 'dread', 'bread', 'shred',
  'cheat', 'pleat', 'wheat',
  'cream', 'dream', 'gleam', 'steam', 'scream', 'stream',
  'creak', 'freak', 'sneak', 'tweak', 'steak', 'break',
  'steal', 'kneel', 'wheel', 'steel',

  // ── Common compound / longer words ────────────────────────────────────────
  'groan', 'groans', 'groaned', 'groaning',
  'stroll', 'strolls', 'strolled', 'strolling', 'stroller',
  'scroll', 'scrolls', 'scrolled', 'scrolling',
  'troll', 'trolls', 'trolled', 'trolling',
  'patrol', 'patrols', 'patrolled', 'patrolling',
  'control', 'controls', 'controlled', 'controlling', 'controller',
  'enroll', 'enrolls', 'enrolled', 'enrolling', 'enrollment',
  'stroll',

  // ── Common -ness, -ment, -ful, -less words ─────────────────────────────────
  'sadness', 'madness', 'gladness',
  'darkness', 'hardness', 'sharpness',
  'boldness', 'coldness',
  'sickness', 'thickness', 'richness',
  'wetness', 'fitness', 'witness',
  'goodness', 'rudeness', 'fondness', 'loneness',
  'payment', 'moment', 'comment', 'cement',
  'torment', 'segment',
  'helpful', 'hopeful', 'useful', 'joyful', 'playful',
  'hateful', 'graceful', 'tasteful', 'wasteful',
  'helpless', 'hopeless', 'useless', 'joyless',

  // ── Common -ly adverbs ────────────────────────────────────────────────────
  'deeply', 'freely', 'widely', 'nicely', 'truly', 'purely',
  'safely', 'lately', 'finely', 'likely', 'timely',
  'lonely', 'lovely', 'lively', 'stately',
  'surely', 'barely', 'rarely', 'nearly', 'clearly',
  'dearly', 'fairly', 'really', 'easily', 'gently', 'softly',
  'boldly', 'coldly',
  'slowly', 'lowly', 'solely', 'wholly',
  'mostly', 'costly', 'firstly', 'lastly',
  'evenly', 'openly', 'calmly',

  // ── Everyday vocab that players would reasonably expect ───────────────────
  'photo', 'photos',
  'total', 'totals', 'totally',
  'local', 'locals', 'locally',
  'legal', 'legals', 'legally',
  'loyal', 'loyally', 'loyalty',
  'royal', 'royals', 'royally', 'royalty',
  'moral', 'morals', 'morally', 'morality',
  'vocal', 'vocals', 'vocally',
  'focal',
  'tonal', 'tonally',
  'modal',
  'nodal',
  'vital', 'vitals', 'vitally',
  'final', 'finals', 'finally',
  'rival', 'rivals',
  'naval', 'navals',
  'basal',
  'renal',
  'tidal',
  'trial', 'trials',
  'drool', 'drools', 'drooled', 'drooling',
  'stool', 'stools',
  'stoop', 'stoops', 'stooped', 'stooping',
  'troop', 'troops', 'trooped', 'trooping',
  'droop', 'droops', 'drooped', 'drooping',
  'snoop', 'snoops', 'snooped', 'snooping', 'snooper',
  'scoop', 'scoops', 'scooped', 'scooping', 'scooper',
  'stoop',
  'stomp', 'stomps', 'stomped', 'stomping',
  'clamp', 'clamps', 'clamped', 'clamping',
  'cramp', 'cramps', 'cramped',
  'tramp', 'tramps', 'tramped',
  'stamp', 'stamps', 'stamped', 'stamping', 'stamper',
  'clamp',
  'crimp', 'crimps', 'crimped',
  'blimp', 'blimps',
  'skimp', 'skimps', 'skimped', 'skimping',
  'chimp', 'chimps',
  'stoic',   // mainstream word — keep (removed from REMOVE list below)
  'oaken',
  'gratin',
];

// ── Obscure / archaic words to remove ─────────────────────────────────────────
const REMOVE = new Set([
  'droit',   // legal "right" — obscure/legalistic
  'toit',    // archaic/dialectal
  'sprue',   // industrial/botany term
  'sprit',   // nautical — obscure
  'fleam',   // archaic medical/agricultural tool
  'fleer',   // archaic "to mock"
  'groat',   // historical coin — obscure to most players
  'stoep',   // South African porch — very regional
  'imago',   // entomology — obscure
  'terce',   // canonical hours — obscure
  'nodus',   // archaic for "knot/difficulty"
  'dixit',   // Latin — very obscure
  'ergot',   // fungal disease — specialist
  'godet',   // sewing term — very specialist
  'genet',   // animal/heraldry — obscure
  'liege',   // feudal term — dated
  'recto',   // printing term — specialist
  'verso',   // printing term — specialist
  'raphe',   // anatomy term — specialist
  'tsuba',   // Japanese sword part — very obscure
]);

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  console.log('Loading existing word list…');
  const base = loadWords(WORDS_FILE);
  console.log(`  ${base.size} words loaded`);

  console.log('Adding curated common words…');
  const merged = new Set(base);
  let added = 0;
  for (const w of ADDITIONS) {
    const word = w.trim().toLowerCase();
    if (word.length >= 5 && /^[a-z]+$/.test(word) && !merged.has(word)) {
      merged.add(word);
      added++;
    }
  }
  console.log(`  +${added} new words added`);

  console.log('Removing obscure words…');
  let removed = 0;
  for (const w of REMOVE) {
    if (merged.delete(w)) removed++;
  }
  console.log(`  -${removed} obscure words removed`);

  const sorted = [...merged].sort();
  writeFileSync(WORDS_FILE, sorted.join('\n') + '\n', 'utf8');
  console.log(`\nWritten ${sorted.length} words to ${WORDS_FILE}`);

  // Summary by length
  for (let len = 5; len <= 10; len++) {
    const count = sorted.filter(w => w.length === len).length;
    if (count > 0) console.log(`  ${len} letters: ${count}`);
  }
  const longer = sorted.filter(w => w.length > 10).length;
  if (longer > 0) console.log(`  11+ letters: ${longer}`);
}

main();
