// The section 10 checks, as pure functions over data already fetched from the chain, so tests
// can run them on fixtures. A check that cannot run yet is WARN, never PASS.
import {
  parseHash,
  rootFromHexLeaves,
  wilson,
  type Backend,
  type Benchmark,
  type Certificate,
  type Eval,
} from "@blindmark/shared";
import {
  attestedPayloads,
  parseJson,
  taskHash,
  verifyQuote,
  type ExecutionEvidence,
  type Measurements,
} from "./attestation.js";

export type { ExecutionEvidence } from "./attestation.js";

export type Status = "PASS" | "FAIL" | "WARN";

export interface CheckResult {
  id: number;
  name: string;
  status: Status;
  details: string[];
}

export interface ChainData {
  eval_id: number;
  certificate: Certificate | null;
  evaluation: Eval | null;
  benchmark: Benchmark | null;
  backends: Backend[];
}

/** Optional results of fetching off-chain data, filled in by the CLI when asked to. */
export interface OffChainData {
  /** sha256(0x00 || fetched ciphertext) per shard, or an error message. */
  shard_hashes?: (string | { error: string })[];
  /** Jobs of the grader's OutLayer project around the eval's lifetime (checks 4 and 5). */
  outlayer?: { executions: ExecutionEvidence[] } | { error: string };
}

/** The OutLayer run the contract accepted for one shard, or for aggregation. */
interface AcceptedRun {
  label: string;
  execution: ExecutionEvidence | null;
  /** Why no run matched, when none did. */
  missing?: string;
  /** An attested run printed a different, conflicting result. */
  conflict?: string;
}

/**
 * Finds, for every shard and for aggregation, the attested run whose input names this eval and
 * whose output is exactly what the contract stored or certified. Only payloads whose hashes the
 * attestation commits to are considered.
 */
function acceptedRuns(
  cert: Certificate,
  evaluation: Eval,
  shardCount: number,
  executions: ExecutionEvidence[],
): AcceptedRun[] {
  const runs = executions.map((e) => {
    const payload = attestedPayloads(e);
    return {
      e,
      input: parseJson(payload.input),
      output: parseJson(payload.output),
    };
  });
  const forEval = runs.filter(
    (r) =>
      r.input?.eval_id === cert.eval_id && r.output?.eval_id === cert.eval_id,
  );
  const out: AcceptedRun[] = [];
  for (let i = 0; i < shardCount; i++) {
    const hit = forEval.find(
      (r) =>
        r.input?.mode === "grade" &&
        r.input.shard_index === i &&
        r.output?.shard_index === i &&
        r.output.ok === true &&
        r.output.sealed_partial === evaluation.partials[i] &&
        r.output.evidence_hash === cert.evidence_hashes[i],
    );
    out.push({
      label: `shard ${i}`,
      execution: hit?.e ?? null,
      missing: hit ? undefined : "no attested run printed the stored result",
    });
  }
  const agg = forEval.find(
    (r) =>
      r.input?.mode === "aggregate" &&
      r.output?.ok === true &&
      r.output.n_items === cert.n_items &&
      r.output.n_correct === cert.n_correct &&
      r.output.score_bps === cert.score_bps &&
      r.output.ci_low_bps === cert.ci_low_bps &&
      r.output.ci_high_bps === cert.ci_high_bps &&
      r.output.mean_latency_ms === cert.mean_latency_ms,
  );
  // Aggregation is deterministic, so an attested aggregate run of this eval that printed other
  // counts contradicts the certificate. (Grade runs are not compared this way: each run seals
  // with a fresh nonce, so a lost run that finished late legitimately differs.)
  const other = agg
    ? undefined
    : forEval.find(
        (r) => r.input?.mode === "aggregate" && r.output?.ok === true,
      );
  out.push({
    label: "aggregation",
    execution: agg?.e ?? null,
    missing: agg ? undefined : "no attested run printed the certified score",
    conflict: other
      ? `OutLayer job ${other.e.job_id} printed ${String(other.output?.n_correct)}/${String(other.output?.n_items)}, not the certified ${cert.n_correct}/${cert.n_items}`
      : undefined,
  });
  return out;
}

class Check {
  private failures: string[] = [];
  private warnings: string[] = [];
  private passes: string[] = [];

  constructor(
    readonly id: number,
    readonly name: string,
  ) {}

  pass(detail: string) {
    this.passes.push(detail);
  }

  fail(detail: string) {
    this.failures.push(detail);
  }

  warn(detail: string) {
    this.warnings.push(detail);
  }

  expect(ok: boolean, passDetail: string, failDetail: string) {
    if (ok) this.pass(passDetail);
    else this.fail(failDetail);
  }

  result(): CheckResult {
    const status: Status =
      this.failures.length > 0
        ? "FAIL"
        : this.warnings.length > 0 || this.passes.length === 0
          ? "WARN"
          : "PASS";
    return {
      id: this.id,
      name: this.name,
      status,
      details: [...this.failures, ...this.warnings, ...this.passes],
    };
  }
}

export function runChecks(
  data: ChainData,
  offChain: OffChainData = {},
): CheckResult[] {
  const { certificate: cert, evaluation, benchmark } = data;

  const exists = new Check(1, "Certificate exists");
  if (!cert) {
    exists.fail(`no certificate for eval ${data.eval_id}`);
    return [exists.result()];
  }
  exists.expect(
    cert.eval_id === data.eval_id,
    `certificate for eval ${cert.eval_id}`,
    `certificate names eval ${cert.eval_id}, expected ${data.eval_id}`,
  );
  if (!evaluation) exists.fail(`eval ${data.eval_id} not found`);
  else
    exists.expect(
      evaluation.status === "Certified",
      "eval status is Certified",
      `eval status is ${evaluation.status}, expected Certified`,
    );
  if (!benchmark) exists.fail(`benchmark ${cert.benchmark_id} not found`);
  const results = [exists.result()];
  if (!evaluation || !benchmark) return results;

  const commitments = new Check(2, "Commitments");
  commitments.expect(
    evaluation.benchmark_id === cert.benchmark_id,
    `benchmark ${cert.benchmark_id}`,
    `eval is for benchmark ${evaluation.benchmark_id}, certificate says ${cert.benchmark_id}`,
  );
  commitments.expect(
    evaluation.model_id === cert.model_id &&
      evaluation.backend_id === cert.backend_id,
    `model ${cert.model_id} on backend ${cert.backend_id}`,
    "certificate model or backend differs from the eval",
  );
  commitments.expect(
    cert.benchmark_version === benchmark.version,
    `benchmark version ${benchmark.version}`,
    `certificate version ${cert.benchmark_version}, benchmark version ${benchmark.version}`,
  );
  commitments.expect(
    cert.dataset_root === benchmark.dataset_root,
    `dataset_root ${short(cert.dataset_root)} matches the benchmark`,
    "certificate dataset_root differs from the benchmark",
  );
  commitments.expect(
    cert.protocol_hash === benchmark.protocol_hash,
    `protocol_hash ${short(cert.protocol_hash)} matches the benchmark`,
    "certificate protocol_hash differs from the benchmark",
  );
  commitments.expect(
    benchmark.created_block < evaluation.created_block,
    `benchmark registered at block ${benchmark.created_block}, before eval block ${evaluation.created_block}`,
    `benchmark block ${benchmark.created_block} is not before eval block ${evaluation.created_block}`,
  );
  results.push(commitments.result());

  const merkle = new Check(3, "Merkle");
  merkle.expect(
    rootFromHexLeaves(benchmark.shard_hashes) === benchmark.dataset_root,
    `dataset_root recomputed from ${benchmark.shard_hashes.length} on-chain shard hashes`,
    "dataset_root does not match the on-chain shard hashes",
  );
  if (offChain.shard_hashes) {
    offChain.shard_hashes.forEach((got, i) => {
      if (typeof got !== "string") merkle.fail(`shard ${i}: ${got.error}`);
      else
        merkle.expect(
          got === benchmark.shard_hashes[i],
          `shard ${i} ciphertext re-hashed`,
          `shard ${i} ciphertext hash differs from the on-chain hash`,
        );
    });
  } else {
    merkle.pass(
      "ciphertexts not fetched (pass --fetch-shards to re-hash them)",
    );
  }
  results.push(merkle.result());

  const build = new Check(4, "Grader build");
  const backend = data.backends.find((b) => b.id === cert.backend_id);
  if (!backend) build.fail(`backend ${cert.backend_id} not found`);
  else {
    build.expect(
      cert.grader_measurement === backend.measurement,
      `grader_measurement ${short(cert.grader_measurement)} equals backend ${backend.id}`,
      `grader_measurement differs from backend ${backend.id} measurement`,
    );
    if (!backend.active)
      build.warn(
        `backend ${backend.id} is now inactive; older certificates stay valid`,
      );
    if (backend.id.startsWith("test-"))
      build.warn(
        `backend ${backend.id} is a test-only backend; this score means nothing`,
      );
  }
  const outlayer = offChain.outlayer;
  let accepted: AcceptedRun[] | null = null;
  if (!outlayer) {
    build.warn("OutLayer execution attestations not fetched");
  } else if ("error" in outlayer) {
    build.warn(
      `OutLayer execution attestations unavailable: ${outlayer.error}`,
    );
  } else {
    accepted = acceptedRuns(
      cert,
      evaluation,
      benchmark.shard_hashes.length,
      outlayer.executions,
    );
    for (const run of accepted) {
      const e = run.execution;
      if (!e?.attestation) {
        if (run.conflict) build.fail(`${run.label}: ${run.conflict}`);
        else build.warn(`${run.label}: ${run.missing}`);
        continue;
      }
      const att = e.attestation;
      const code = att.executed_wasm_sha256 ?? att.wasm_hash ?? "unknown";
      build.expect(
        att.wasm_hash === cert.grader_measurement &&
          (!att.executed_wasm_sha256 ||
            att.executed_wasm_sha256 === cert.grader_measurement),
        `${run.label}: OutLayer job ${e.job_id} ran ${short(cert.grader_measurement)} (tx ${short(e.transaction_hash)})`,
        `${run.label}: OutLayer job ${e.job_id} ran code ${short(code)}, not the certified grader`,
      );
      const input = parseJson(attestedPayloads(e).input);
      build.expect(
        input?.nonce === evaluation.nonce,
        `${run.label}: input carries the eval's nonce`,
        `${run.label}: input nonce differs from the eval's nonce`,
      );
    }
  }
  results.push(build.result());

  const intel = new Check(5, "Intel attestation");
  if (!accepted) {
    intel.warn("no OutLayer runs to check (see check 4)");
  } else {
    let verified = 0;
    for (const run of accepted) {
      const e = run.execution;
      const att = e?.attestation;
      if (!e || !att) {
        intel.warn(`${run.label}: no attested run to check`);
        continue;
      }
      const coll = e.collateral;
      if (!coll || "error" in coll) {
        intel.warn(
          `${run.label}: Intel collateral unavailable${coll ? `: ${coll.error}` : ""}`,
        );
        continue;
      }
      let quote;
      try {
        quote = verifyQuote(att.tdx_quote, coll.body, att.timestamp);
      } catch (error) {
        intel.fail(
          `${run.label}: TDX quote does not verify to Intel's root: ${(error as Error).message}`,
        );
        continue;
      }
      let ok = true;
      if (quote.report_data_prefix !== taskHash(att)) {
        intel.fail(
          `${run.label}: quote report_data does not commit to this run's record`,
        );
        ok = false;
      }
      if (quote.status === "Revoked") {
        intel.fail(`${run.label}: Intel reports the platform as Revoked`);
        ok = false;
      } else if (quote.status !== "UpToDate") {
        intel.warn(`${run.label}: Intel TCB status ${quote.status}`);
      }
      if (!coll.covers_time)
        intel.warn(
          `${run.label}: archived collateral does not cover the run's time`,
        );
      const approval = e.approval;
      if (!approval || "error" in approval) {
        intel.warn(
          `${run.label}: worker build approval unknown${approval ? `: ${approval.error}` : ""}`,
        );
        ok = false;
      } else if (!sameMeasurements(approval.measurements, quote.measurements)) {
        intel.warn(
          `${run.label}: approval was looked up for other measurements than the verified quote's`,
        );
        ok = false;
      } else if (!approval.approved) {
        intel.fail(
          `${run.label}: worker measurements are not approved on OutLayer's register contract`,
        );
        ok = false;
      }
      if (ok) verified++;
    }
    const summary =
      `${verified} of ${accepted.length} runs: Intel-signed TDX quote, report_data commits to ` +
      "the attested code, input and output, worker build approved on chain";
    if (verified === accepted.length) intel.pass(summary);
    else intel.warn(summary);
  }
  results.push(intel.result());

  const evidence = new Check(6, "Model evidence");
  evidence.expect(
    cert.evidence_hashes.length === benchmark.shard_hashes.length,
    `${cert.evidence_hashes.length} evidence hashes, one per shard`,
    `${cert.evidence_hashes.length} evidence hashes for ${benchmark.shard_hashes.length} shards`,
  );
  const malformed = cert.evidence_hashes.filter((h) => parseHash(h) === null);
  if (malformed.length > 0)
    evidence.fail(
      `${malformed.length} evidence hashes are not 64 lowercase hex`,
    );
  evidence.warn(
    "evidence bundles not fetched: storage not decided (spike S5); 0 calls counted as verified",
  );
  results.push(evidence.result());

  const stats = new Check(7, "Statistics");
  stats.expect(
    cert.n_items === benchmark.item_count,
    `n_items ${cert.n_items} equals benchmark item_count`,
    `n_items ${cert.n_items}, benchmark has ${benchmark.item_count} items`,
  );
  try {
    const expected = wilson(cert.n_correct, cert.n_items);
    stats.expect(
      expected.score_bps === cert.score_bps &&
        expected.ci_low_bps === cert.ci_low_bps &&
        expected.ci_high_bps === cert.ci_high_bps,
      `${cert.n_correct}/${cert.n_items} gives ${bps(expected.score_bps)} [${bps(expected.ci_low_bps)}, ${bps(expected.ci_high_bps)}]`,
      `certificate says ${bps(cert.score_bps)} [${bps(cert.ci_low_bps)}, ${bps(cert.ci_high_bps)}], ${cert.n_correct}/${cert.n_items} gives ${bps(expected.score_bps)} [${bps(expected.ci_low_bps)}, ${bps(expected.ci_high_bps)}]`,
    );
  } catch {
    stats.fail(
      `impossible counts: ${cert.n_correct} correct of ${cert.n_items}`,
    );
  }
  results.push(stats.result());

  return results;
}

function sameMeasurements(a: Measurements, b: Measurements): boolean {
  return (
    a.mrtd === b.mrtd &&
    a.rtmr0 === b.rtmr0 &&
    a.rtmr1 === b.rtmr1 &&
    a.rtmr2 === b.rtmr2 &&
    a.rtmr3 === b.rtmr3
  );
}

function short(hash: string): string {
  return `${hash.slice(0, 10)}...`;
}

function bps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}
