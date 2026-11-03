// Contract reads shared by the explorer views (`/` and `/leaderboard`).
import type { Benchmark, Certificate } from "@blindmark/shared";
import { leaderboard, type LeaderboardRow } from "./leaderboard";
import { getUsage, listBenchmarks, listCertificates } from "./rpc";

export type ExploreRow = LeaderboardRow & {
  benchmark: Benchmark;
  attempts: number;
  /** Score change from this model's previous certificate on the same benchmark, in bps. */
  change: number | null;
};

export interface ExploreData {
  benchmarks: Benchmark[];
  certificates: Certificate[];
  /** Latest certificate per (benchmark, model), never the best. */
  rows: ExploreRow[];
  /** When the contract was read, in ms; ages such as "3h ago" are measured from it. */
  readAt: number;
}

export async function loadExplore(): Promise<ExploreData> {
  const benchmarks = await listBenchmarks();
  const perBenchmark = await Promise.all(
    benchmarks.map(async (benchmark) => {
      const certificates = await listCertificates(benchmark.id);
      const rows = await Promise.all(
        leaderboard(certificates).map(async (r): Promise<ExploreRow> => {
          const usage = await getUsage(benchmark.id, r.certificate.model_id);
          const previous = certificates
            .filter(
              (c) =>
                c.model_id === r.certificate.model_id &&
                c.eval_id < r.certificate.eval_id,
            )
            .sort((a, b) => b.eval_id - a.eval_id)[0];
          return {
            ...r,
            benchmark,
            attempts: usage?.count ?? r.certified,
            change: previous
              ? r.certificate.score_bps - previous.score_bps
              : null,
          };
        }),
      );
      return { certificates, rows };
    }),
  );
  return {
    readAt: Date.now(),
    benchmarks,
    certificates: perBenchmark.flatMap((p) => p.certificates),
    rows: perBenchmark.flatMap((p) => p.rows),
  };
}
