// Accuracy and Wilson score interval. Spec: CLAUDE.md section 5.5.

const Z = 1.96;

export interface Score {
  score_bps: number;
  ci_low_bps: number;
  ci_high_bps: number;
}

/** floor(x * 10000 + 0.5), clamped to 0..=10000, so Rust and TS agree. */
export function toBps(x: number): number {
  return Math.min(10000, Math.max(0, Math.floor(x * 10000 + 0.5)));
}

/** Throws unless 0 <= k <= n and n > 0. */
export function wilson(k: number, n: number): Score {
  if (
    !Number.isInteger(k) ||
    !Number.isInteger(n) ||
    n <= 0 ||
    k < 0 ||
    k > n
  ) {
    throw new Error("wilson: need integers with 0 <= k <= n and n > 0");
  }
  const p = k / n;
  const z2 = Z * Z;
  const d = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / d;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return {
    score_bps: toBps(p),
    ci_low_bps: toBps(center - half),
    ci_high_bps: toBps(center + half),
  };
}

/** Leaderboard rule: two models are statistically tied when their intervals overlap. */
export function statisticallyTied(
  a: Pick<Score, "ci_low_bps" | "ci_high_bps">,
  b: Pick<Score, "ci_low_bps" | "ci_high_bps">,
): boolean {
  return a.ci_low_bps <= b.ci_high_bps && b.ci_low_bps <= a.ci_high_bps;
}
