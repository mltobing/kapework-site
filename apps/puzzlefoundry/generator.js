/**
 * generator.js — Puzzle Foundry pack generator
 *
 * Builds a candidate pool from all twist × family combos, scores each,
 * and selects 8 cards with pack-composition constraints:
 *   - no more than 3 cards from any single family
 *   - ideally all 3 families represented
 *   - no duplicate twist IDs in the same pack
 */

import { ALL_TWISTS, FAMILIES, FAMILY_META } from './seeds.js';
import { generate as generateTargetForge } from './families/target-forge.js';
import { generate as generateOrderRepair  } from './families/order-repair.js';
import { generate as generatePathTrace    } from './families/path-trace.js';

const PACK_SIZE = 8;
const MAX_PER_FAMILY = 3;

// ── Puzzle instantiator ────────────────────────────────────────────────────
/**
 * instantiatePuzzle(seed, difficultyKey) → puzzle object or null
 *
 * Calls the appropriate family generator. Returns null if generation fails.
 */
export function instantiatePuzzle(twist, difficultyKey) {
  switch (twist.family) {
    case FAMILIES.TARGET_FORGE: return generateTargetForge(twist, difficultyKey);
    case FAMILIES.ORDER_REPAIR:  return generateOrderRepair(twist, difficultyKey);
    case FAMILIES.PATH_TRACE:    return generatePathTrace(twist, difficultyKey);
    default: return null;
  }
}

// ── Candidate scoring ──────────────────────────────────────────────────────
/**
 * Score a candidate seed for pack inclusion.
 * Higher is better. Used to rank when we have more candidates than needed.
 *
 * Criteria:
 *   clarity    — short hook text, easy to parse
 *   surprise   — non-default difficulty tendency gets a small bonus
 *   mobile     — all families are mobile-suitable in v1
 */
function scoreCandidate(twist) {
  let score = 50; // baseline
  // Prefer twists with distinct hooks
  if (twist.hook.length < 50) score += 10;
  // Slight bonus for twists with a non-trivial difficulty tendency
  if (twist.difficultyTend === 'hard') score += 5;
  // Small random jitter for variety across refreshes
  score += Math.random() * 20;
  return score;
}

// ── Pack builder ──────────────────────────────────────────────────────────
/**
 * generatePack() → array of 8 seed-card objects
 *
 * Each card: { id, family, twistId, name, hook, tags, familyMeta, score }
 * No actual puzzle is instantiated here — puzzles are generated on demand
 * when the player taps a card and selects difficulty.
 */
export function generatePack() {
  // Score all twists
  const scored = ALL_TWISTS.map(t => ({ twist: t, score: scoreCandidate(t) }));
  scored.sort((a, b) => b.score - a.score);

  // Build pack respecting composition rules
  const pack = [];
  const familyCounts = {
    [FAMILIES.TARGET_FORGE]: 0,
    [FAMILIES.ORDER_REPAIR]:  0,
    [FAMILIES.PATH_TRACE]:    0,
  };
  const usedTwistIds = new Set();

  // Pass 1: try to get at least 1 from each family
  const families = [FAMILIES.TARGET_FORGE, FAMILIES.ORDER_REPAIR, FAMILIES.PATH_TRACE];
  for (const fam of families) {
    const candidate = scored.find(
      c => c.twist.family === fam && !usedTwistIds.has(c.twist.id)
    );
    if (candidate) {
      pack.push(buildCard(candidate.twist));
      familyCounts[fam]++;
      usedTwistIds.add(candidate.twist.id);
    }
  }

  // Pass 2: fill remaining slots from all families, respecting MAX_PER_FAMILY
  for (const { twist } of scored) {
    if (pack.length >= PACK_SIZE) break;
    if (usedTwistIds.has(twist.id)) continue;
    if (familyCounts[twist.family] >= MAX_PER_FAMILY) continue;
    pack.push(buildCard(twist));
    familyCounts[twist.family]++;
    usedTwistIds.add(twist.id);
  }

  // If somehow short (shouldn't happen with 14 twists), allow repeats from any family
  const allTwistsShuffled = [...ALL_TWISTS].sort(() => Math.random() - 0.5);
  for (const twist of allTwistsShuffled) {
    if (pack.length >= PACK_SIZE) break;
    if (usedTwistIds.has(twist.id)) continue;
    pack.push(buildCard(twist));
    usedTwistIds.add(twist.id);
  }

  return pack.slice(0, PACK_SIZE);
}

function buildCard(twist) {
  return {
    id:         `${twist.family}__${twist.id}`,
    family:     twist.family,
    twistId:    twist.id,
    name:       twist.name,
    hook:       twist.hook,
    tags:       twist.tags,
    familyMeta: FAMILY_META[twist.family],
    twist,      // full twist object for instantiation
  };
}
