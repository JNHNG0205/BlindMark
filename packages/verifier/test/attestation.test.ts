import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inputHash, outputHash, taskHash } from "../src/attestation.js";
import {
  runChecks,
  type ChainData,
  type ExecutionEvidence,
  type OffChainData,
} from "../src/checks.js";

// Real records of testnet eval 0 and its OutLayer runs (jobs, attestations with Intel TDX
// quotes, transaction payloads, archived collateral), captured on 2026-11-04.
const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
const chain: ChainData = read("testnet-eval-0.json");
const outlayer: { executions: ExecutionEvidence[] } = read(
  "testnet-eval-0-outlayer.json",
);

/**
 * Eval 0 exactly as certified (its stub interval is wrong, which only check 7 judges), on a
 * non-test backend id so check 4 has no test-backend warning.
 */
function data(): ChainData {
  const d: ChainData = structuredClone(chain);
  const id = "outlayer-v1";
  d.backends.find((b) => b.id === d.certificate!.backend_id)!.id = id;
  d.certificate!.backend_id = id;
  d.evaluation!.backend_id = id;
  return d;
}

function evidence(): { executions: ExecutionEvidence[] } {
  return structuredClone(outlayer);
}

/** The attested run that produced the certified aggregate. */
function aggregateRun(o: { executions: ExecutionEvidence[] }) {
  return o.executions.find((e) =>
    e.inputs.some((i) => i.includes('"mode":"aggregate"')),
  )!;
}

const check = (d: ChainData, off: OffChainData, id: number) =>
  runChecks(d, off).find((r) => r.id === id)!;

describe("OutLayer attestations (checks 4 and 5)", () => {
  it("recomputes the record hashes the quote commits to", () => {
    const run = aggregateRun(evidence());
    const att = run.attestation!;
    expect(run.inputs.map(inputHash)).toContain(att.input_hash);
    expect(run.outputs.map(outputHash)).toContain(att.output_hash);
    expect(taskHash(att)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("passes on the real runs of eval 0", () => {
    const d = data();
    const off = { outlayer: evidence() };
    const build = check(d, off, 4);
    expect(build.status).toBe("PASS");
    expect(build.details.join("\n")).toContain("shard 0: OutLayer job");
    expect(build.details.join("\n")).toContain("aggregation: OutLayer job");
    const intel = check(d, off, 5);
    expect(intel.status).toBe("PASS");
    expect(intel.details).toContain(
      "3 of 3 runs: Intel-signed TDX quote, report_data commits to the attested code, input and output, worker build approved on chain",
    );
  });

  it("warns, never passes, when attestations were not fetched or are unavailable", () => {
    expect(check(data(), {}, 4).status).toBe("WARN");
    expect(check(data(), {}, 5).status).toBe("WARN");
    const off = { outlayer: { error: "HTTP 503" } };
    expect(check(data(), off, 4).status).toBe("WARN");
    expect(check(data(), off, 5).status).toBe("WARN");
  });

  it("fails when the accepted run executed other code than the certified grader", () => {
    const d = data();
    const other = "ab".repeat(32);
    d.certificate!.grader_measurement = other;
    d.backends.find((b) => b.id === "outlayer-v1")!.measurement = other;
    const build = check(d, { outlayer: evidence() }, 4);
    expect(build.status).toBe("FAIL");
    expect(build.details[0]).toContain("not the certified grader");
  });

  it("fails a record edited to name the certified grader: the quote no longer matches", () => {
    const d = data();
    const other = "ab".repeat(32);
    d.certificate!.grader_measurement = other;
    d.backends.find((b) => b.id === "outlayer-v1")!.measurement = other;
    const o = evidence();
    for (const e of o.executions) {
      if (e.attestation) {
        e.attestation.wasm_hash = other;
        e.attestation.executed_wasm_sha256 = other;
      }
    }
    expect(check(d, { outlayer: o }, 4).status).toBe("PASS");
    const intel = check(d, { outlayer: o }, 5);
    expect(intel.status).toBe("FAIL");
    expect(intel.details[0]).toContain("does not commit to this run's record");
  });

  it("fails a quote with a changed byte", () => {
    const o = evidence();
    const att = aggregateRun(o).attestation!;
    const bytes = Uint8Array.from(atob(att.tdx_quote), (c) => c.charCodeAt(0));
    bytes[100]! ^= 1; // inside the signed TD report
    att.tdx_quote = btoa(String.fromCharCode(...bytes));
    const intel = check(data(), { outlayer: o }, 5);
    expect(intel.status).toBe("FAIL");
    expect(intel.details[0]).toContain("aggregation");
  });

  it("fails a worker build the register contract does not approve", () => {
    const o = evidence();
    const run = aggregateRun(o);
    if (!run.approval || "error" in run.approval) throw new Error("fixture");
    run.approval.approved = false;
    expect(check(data(), { outlayer: o }, 5).status).toBe("FAIL");
  });

  it("warns when collateral or approval could not be fetched", () => {
    const o = evidence();
    aggregateRun(o).collateral = { error: "HTTP 404" };
    expect(check(data(), { outlayer: o }, 5).status).toBe("WARN");
    const p = evidence();
    aggregateRun(p).approval = { error: "RPC down" };
    expect(check(data(), { outlayer: p }, 5).status).toBe("WARN");
  });

  it("warns when no attested run produced a stored shard result", () => {
    const d = data();
    d.evaluation!.partials[1] = "something-else";
    const build = check(d, { outlayer: evidence() }, 4);
    expect(build.status).toBe("WARN");
    expect(build.details).toContain(
      "shard 1: no attested run printed the stored result",
    );
  });

  it("fails a certified score that the attested aggregate run did not print", () => {
    const d = data();
    d.certificate!.n_correct = 3;
    // Keep the statistics self-consistent so only the attestation catches it.
    d.certificate!.score_bps = 3000;
    d.certificate!.ci_low_bps = 1078;
    d.certificate!.ci_high_bps = 6032;
    expect(check(d, { outlayer: evidence() }, 7).status).toBe("PASS");
    const build = check(d, { outlayer: evidence() }, 4);
    expect(build.status).toBe("FAIL");
    expect(build.details[0]).toContain("printed 0/10, not the certified 3/10");
  });

  it("ignores payloads the attestation does not commit to", () => {
    const o = evidence();
    const run = aggregateRun(o);
    // A forged output added to the transaction data is not the attested one.
    run.outputs = run.outputs.map((out) =>
      out.replace('"n_correct":0', '"n_correct":3'),
    );
    const build = check(data(), { outlayer: o }, 4);
    expect(build.status).toBe("WARN");
  });
});
