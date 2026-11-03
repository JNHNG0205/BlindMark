import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runChecks, type ChainData } from "../src/checks.js";

// Real records of testnet eval 0, captured on 2026-11-03. Its stub grader printed a hardcoded
// interval of [0, 0], which the verifier must reject.
const testnet: ChainData = JSON.parse(
  readFileSync(
    new URL("./fixtures/testnet-eval-0.json", import.meta.url),
    "utf8",
  ),
);

/** The same records with the interval the stub should have printed for 0/10. */
function consistent(): ChainData {
  const data: ChainData = structuredClone(testnet);
  data.certificate!.ci_high_bps = 2775;
  return data;
}

const statusOf = (data: ChainData, id: number) =>
  runChecks(data).find((r) => r.id === id)?.status;

describe("verifier checks", () => {
  it("fails the real testnet stub certificate on statistics", () => {
    expect(statusOf(testnet, 7)).toBe("FAIL");
  });

  it("has no failures on a consistent certificate, but never passes unchecked items", () => {
    const results = runChecks(consistent());
    expect(results.map((r) => r.status)).toEqual([
      "PASS",
      "PASS",
      "PASS",
      "WARN",
      "WARN",
      "WARN",
      "PASS",
    ]);
  });

  it("fails an altered score", () => {
    const data = consistent();
    data.certificate!.score_bps = 9000;
    expect(statusOf(data, 7)).toBe("FAIL");
  });

  it("fails altered counts", () => {
    const data = consistent();
    data.certificate!.n_correct = 11;
    expect(statusOf(data, 7)).toBe("FAIL");
    const fewer = consistent();
    fewer.certificate!.n_items = 9;
    expect(statusOf(fewer, 7)).toBe("FAIL");
  });

  it("fails altered commitments", () => {
    const data = consistent();
    data.certificate!.dataset_root = "0".repeat(64);
    expect(statusOf(data, 2)).toBe("FAIL");
    const late = consistent();
    late.benchmark!.created_block = late.evaluation!.created_block;
    expect(statusOf(late, 2)).toBe("FAIL");
  });

  it("fails a dataset_root that does not match the shard hashes", () => {
    const data = consistent();
    data.benchmark!.shard_hashes[0] = "0".repeat(64);
    expect(statusOf(data, 3)).toBe("FAIL");
  });

  it("fails re-hashed ciphertexts that differ or cannot be fetched", () => {
    const data = consistent();
    const good = data.benchmark!.shard_hashes;
    const check = (hashes: (string | { error: string })[]) =>
      runChecks(data, { shard_hashes: hashes }).find((r) => r.id === 3)?.status;
    expect(check([...good])).toBe("PASS");
    expect(check([good[0]!, "1".repeat(64)])).toBe("FAIL");
    expect(check([good[0]!, { error: "HTTP 404" }])).toBe("FAIL");
  });

  it("fails a measurement that differs from the backend", () => {
    const data = consistent();
    data.certificate!.grader_measurement = "f".repeat(64);
    expect(statusOf(data, 4)).toBe("FAIL");
    data.backends = [];
    expect(statusOf(data, 4)).toBe("FAIL");
  });

  it("fails when the eval is not certified or the certificate is missing", () => {
    const data = consistent();
    data.evaluation!.status = "Refunded";
    expect(statusOf(data, 1)).toBe("FAIL");
    expect(runChecks({ ...consistent(), certificate: null })).toEqual([
      expect.objectContaining({ id: 1, status: "FAIL" }),
    ]);
  });
});
