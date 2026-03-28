/**
 * seeds.js — Puzzle Foundry seed definitions
 *
 * Each family has a curated twist library. A seed = family + twist + metadata.
 * Seeds are pure data; families/*.js instantiate real puzzles from them.
 */

export const FAMILIES = {
  TARGET_FORGE: 'target-forge',
  ORDER_REPAIR:  'order-repair',
  PATH_TRACE:    'path-trace',
};

export const FAMILY_META = {
  [FAMILIES.TARGET_FORGE]: {
    label: 'Target Forge',
    badge: '◎',
    color: '#f59e0b',
    colorDim: 'rgba(245,158,11,0.15)',
  },
  [FAMILIES.ORDER_REPAIR]: {
    label: 'Order Repair',
    badge: '⇄',
    color: '#818cf8',
    colorDim: 'rgba(129,140,248,0.15)',
  },
  [FAMILIES.PATH_TRACE]: {
    label: 'Path Trace',
    badge: '⬡',
    color: '#34d399',
    colorDim: 'rgba(52,211,153,0.15)',
  },
};

// ── Target Forge twists ──────────────────────────────────────────────────────
export const TARGET_FORGE_TWISTS = [
  {
    id: 'lockout',
    family: FAMILIES.TARGET_FORGE,
    name: 'Lockout',
    hook: 'Hit the target — but multiplication is banned.',
    tags: ['no ×', 'operators'],
    difficultyTend: 'medium',
    bannedOps: ['*'],
  },
  {
    id: 'one_each',
    family: FAMILIES.TARGET_FORGE,
    name: 'One Each',
    hook: 'Reach the target using each operator at most once.',
    tags: ['each once', 'variety'],
    difficultyTend: 'medium',
    bannedOps: [],
  },
  {
    id: 'last_tile',
    family: FAMILIES.TARGET_FORGE,
    name: 'Last Tile',
    hook: 'One marked number must be your final move.',
    tags: ['order', 'forced last'],
    difficultyTend: 'hard',
    bannedOps: [],
  },
  {
    id: 'stepstone',
    family: FAMILIES.TARGET_FORGE,
    name: 'Stepstone',
    hook: 'Hit a checkpoint on the way to the target.',
    tags: ['checkpoint', 'two steps'],
    difficultyTend: 'hard',
    bannedOps: [],
  },
  {
    id: 'div_ban',
    family: FAMILIES.TARGET_FORGE,
    name: 'No Fractions',
    hook: 'Division is off the table — whole numbers only.',
    tags: ['no ÷', 'operators'],
    difficultyTend: 'easy',
    bannedOps: ['/'],
  },
];

// ── Order Repair twists ──────────────────────────────────────────────────────
export const ORDER_REPAIR_TWISTS = [
  {
    id: 'adjacent_only',
    family: FAMILIES.ORDER_REPAIR,
    name: 'Slide',
    hook: 'Restore the row — adjacent swaps only.',
    tags: ['adjacent', 'sort'],
    difficultyTend: 'easy',
  },
  {
    id: 'odd_sum',
    family: FAMILIES.ORDER_REPAIR,
    name: 'Odd Swap',
    hook: 'You may only swap neighbors whose sum is odd.',
    tags: ['odd sum', 'parity'],
    difficultyTend: 'medium',
  },
  {
    id: 'anchor',
    family: FAMILIES.ORDER_REPAIR,
    name: 'Anchor Row',
    hook: 'Sort the line — one tile is fixed and cannot move.',
    tags: ['anchored', 'fixed tile'],
    difficultyTend: 'medium',
  },
  {
    id: 'skip_two',
    family: FAMILIES.ORDER_REPAIR,
    name: 'Skip Shift',
    hook: 'You may only swap tiles exactly two positions apart.',
    tags: ['skip', 'distance'],
    difficultyTend: 'hard',
  },
  {
    id: 'mirror',
    family: FAMILIES.ORDER_REPAIR,
    name: 'Mirror Sort',
    hook: 'Every swap triggers its mirror swap simultaneously.',
    tags: ['mirror', 'symmetric'],
    difficultyTend: 'hard',
  },
];

// ── Path Trace twists ────────────────────────────────────────────────────────
export const PATH_TRACE_TWISTS = [
  {
    id: 'exact_turns',
    family: FAMILIES.PATH_TRACE,
    name: 'Turn Budget',
    hook: 'Reach the goal in exactly the right number of steps.',
    tags: ['exact', 'counting'],
    difficultyTend: 'medium',
  },
  {
    id: 'visit_all',
    family: FAMILIES.PATH_TRACE,
    name: 'Mark Sweep',
    hook: 'Visit every marked cell before reaching the exit.',
    tags: ['collect', 'coverage'],
    difficultyTend: 'medium',
  },
  {
    id: 'no_color_repeat',
    family: FAMILIES.PATH_TRACE,
    name: 'Color Trail',
    hook: 'Trace a path without stepping on the same color twice.',
    tags: ['color', 'no repeat'],
    difficultyTend: 'hard',
  },
  {
    id: 'collect_key',
    family: FAMILIES.PATH_TRACE,
    name: 'Gate Run',
    hook: 'Collect the key, then reach the exit.',
    tags: ['key', 'sequence'],
    difficultyTend: 'easy',
  },
];

// All twists in a flat array for the generator to iterate
export const ALL_TWISTS = [
  ...TARGET_FORGE_TWISTS,
  ...ORDER_REPAIR_TWISTS,
  ...PATH_TRACE_TWISTS,
];
