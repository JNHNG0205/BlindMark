import { statisticallyTied, type Certificate } from "@blindmark/shared";

export interface LeaderboardRow {
  rank: number;
  certificate: Certificate;
  /** Certificates this model has on this benchmark. */
  certified: number;
  /** Ranks of other rows whose interval overlaps this one. */
  tiedWith: number[];
}

/**
 * One row per model: its latest certificate, never its best, because best-of-N inflates
 * scores (CLAUDE.md section 11). Sorted by score, highest first.
 */
export function leaderboard(certificates: Certificate[]): LeaderboardRow[] {
  const latest = new Map<string, Certificate>();
  const counts = new Map<string, number>();
  for (const cert of certificates) {
    counts.set(cert.model_id, (counts.get(cert.model_id) ?? 0) + 1);
    const current = latest.get(cert.model_id);
    if (!current || cert.eval_id > current.eval_id)
      latest.set(cert.model_id, cert);
  }
  const sorted = [...latest.values()].sort(
    (a, b) => b.score_bps - a.score_bps || a.eval_id - b.eval_id,
  );
  return sorted.map((certificate, i) => ({
    rank: i + 1,
    certificate,
    certified: counts.get(certificate.model_id) ?? 0,
    tiedWith: sorted.flatMap((other, j) =>
      j !== i && statisticallyTied(certificate, other) ? [j + 1] : [],
    ),
  }));
}
