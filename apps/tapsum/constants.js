export const BOARDS_PER_RUN      = 10;
export const LIVES               = 3;
export const BOARD_TIME          = 10;       // seconds per board
export const OVER_PENALTY        = 2;        // seconds lost when going over target
export const BASE_SCORE          = 100;      // base points per cleared board
export const SPEED_BONUS_MAX     = 100;      // max bonus for a perfect-speed solve
// Multiplier indexed by current chain length; capped at last entry
export const CHAIN_MULTIPLIERS   = [1, 1.5, 2, 2.5, 3];
export const SLUG                = 'tapsum';
export const STORAGE = {
  DEVICE_ID: 'kapework_did_v1',
  BEST_SCORE: 'tapsum_best_score_v2',
  TODAY:      'tapsum_today_v2',
};
