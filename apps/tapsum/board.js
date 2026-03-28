const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

/**
 * Generates a solvable 3×3 board.
 * Guarantees at least one valid combination by injecting 2–4 "must" numbers
 * whose sum equals the target.
 *
 * @returns {{ target: number, cells: Array<{val: number, selected: boolean}> }}
 */
export function generateBoard() {
  const must   = Array.from({ length: rand(2, 4) }, () => rand(1, 9));
  const target = must.reduce((a, b) => a + b, 0);

  const vals  = Array.from({ length: 9 }, () => rand(1, 9));
  const slots = [...Array(9).keys()]
    .sort(() => Math.random() - 0.5)
    .slice(0, must.length);
  slots.forEach((pos, i) => { vals[pos] = must[i]; });

  return {
    target,
    cells: vals.map(val => ({ val, selected: false })),
  };
}
