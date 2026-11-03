import { describe, expect, it } from "vitest";
import type { Certificate } from "@blindmark/shared";
import { leaderboard } from "./leaderboard";

function cert(
  eval_id: number,
  model_id: string,
  score: number,
  low: number,
  high: number,
): Certificate {
  return {
    eval_id,
    model_id,
    score_bps: score,
    ci_low_bps: low,
    ci_high_bps: high,
  } as Certificate;
}

describe("leaderboard", () => {
  it("shows each model's latest certificate, not its best, with its count", () => {
    const rows = leaderboard([
      cert(1, "m1", 9000, 8800, 9200),
      cert(4, "m1", 6000, 5800, 6200),
      cert(2, "m2", 7000, 6800, 7200),
    ]);
    expect(
      rows.map((r) => [
        r.rank,
        r.certificate.model_id,
        r.certificate.eval_id,
        r.certified,
      ]),
    ).toEqual([
      [1, "m2", 2, 1],
      [2, "m1", 4, 2],
    ]);
  });

  it("labels overlapping intervals as tied", () => {
    const rows = leaderboard([
      cert(1, "a", 7000, 6500, 7500),
      cert(2, "b", 6800, 6300, 7300),
      cert(3, "c", 3000, 2500, 3500),
    ]);
    expect(rows.map((r) => r.tiedWith)).toEqual([[2], [1], []]);
  });
});
