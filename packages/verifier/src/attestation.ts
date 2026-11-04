// OutLayer execution attestations (CLAUDE.md section 10, checks 4 and 5), as pure functions over
// data the CLI has fetched, so tests can run them on fixtures.
//
// Each OutLayer run publishes a record whose fields (code hash, input hash, output hash, caller,
// ...) are hashed into the `report_data` of an Intel TDX quote. Format and field order follow
// OutLayer's own verifier, github.com/out-layer/outlayer-verify (crates/verify-core).
import { sha256 } from "@noble/hashes/sha2.js";
import { toHex } from "@blindmark/shared";
import { QuoteVerifier, type Collateral } from "@phala/dcap-qvl";

/** An attestation record exactly as the OutLayer API serves it. */
export interface AttestationRecord {
  task_id: number;
  task_type: string;
  tdx_quote: string;
  timestamp: number;
  output_hash: string;
  input_hash?: string | null;
  repo_url?: string | null;
  commit_hash?: string | null;
  build_target?: string | null;
  wasm_hash?: string | null;
  executed_wasm_sha256?: string | null;
  block_height?: number | null;
  caller_account_id?: string | null;
  project_id?: string | null;
  secrets_ref?: string | null;
  attached_usd?: string | null;
  transaction_hash?: string | null;
  request_id?: number | null;
  worker_measurement?: string | null;
}

export interface Measurements {
  mrtd: string;
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
  rtmr3: string;
}

/** One OutLayer job of the grader project, with what its NEAR transaction carries. */
export interface ExecutionEvidence {
  job_id: number;
  transaction_hash: string;
  /** null when OutLayer published no attestation for the job. */
  attestation: AttestationRecord | null;
  /** `input_data` of every `execution_requested` event in the transaction. */
  inputs: string[];
  /** Every value the OutLayer contract returned in the transaction. */
  outputs: string[];
  /** Intel collateral valid at the run's time, as OutLayer archives it. */
  collateral?: { body: Collateral; covers_time: boolean } | { error: string };
  /** The register contract's answer for the measurements read from this quote. */
  approval?:
    { measurements: Measurements; approved: boolean } | { error: string };
}

/** Records from this instant on commit to the extended (V1) field set (outlayer-verify). */
export const V1_CUTOFF = 1_769_784_939;

const utf8 = (text: string) => new TextEncoder().encode(text);

function le64(value: number, signed: boolean): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  if (signed) view.setBigInt64(0, BigInt(value), true);
  else view.setBigUint64(0, BigInt(value), true);
  return out;
}

/** The 32-byte commitment the worker put in `report_data` before Intel signed the quote. */
export function taskHash(att: AttestationRecord): string {
  const parts: Uint8Array[] = [utf8(att.task_type), le64(att.task_id, true)];
  for (const field of [
    att.repo_url,
    att.commit_hash,
    att.build_target,
    att.wasm_hash,
    att.input_hash,
  ]) {
    if (field) parts.push(utf8(field));
  }
  parts.push(utf8(att.output_hash));
  if (att.block_height) parts.push(le64(att.block_height, false));
  if (att.timestamp >= V1_CUTOFF) {
    for (const field of [
      att.caller_account_id,
      att.project_id,
      att.secrets_ref,
    ]) {
      if (field) parts.push(utf8(field));
    }
    parts.push(le64(att.timestamp, true));
    if (att.attached_usd) parts.push(utf8(att.attached_usd));
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    all.set(p, offset);
    offset += p.length;
  }
  return toHex(sha256(all));
}

/** sha256 of the exact input string the contract sent. */
export function inputHash(input: string): string {
  return toHex(sha256(utf8(input)));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** The worker hashes its output as compact JSON with sorted keys. */
export function outputHash(output: string): string | null {
  try {
    return toHex(sha256(utf8(JSON.stringify(sortKeys(JSON.parse(output))))));
  } catch {
    return null;
  }
}

export function decodeBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export interface QuoteResult {
  status: string;
  advisory_ids: string[];
  measurements: Measurements;
  /** First 32 bytes of report_data, hex. */
  report_data_prefix: string;
}

/**
 * Verifies the quote's signature chain to Intel's root (compiled into dcap-qvl) with the
 * collateral valid at the run's own time. Throws if any signature or certificate check fails.
 */
export function verifyQuote(
  quoteBase64: string,
  collateral: Collateral,
  atSeconds: number,
): QuoteResult {
  const verified = QuoteVerifier.newProd().verify(
    decodeBase64(quoteBase64),
    collateral,
    atSeconds,
  );
  const report = verified.report;
  const td = report.asTd10() ?? report.asTd15()?.base ?? null;
  if (!td) throw new Error("not a TDX quote");
  return {
    status: verified.status,
    advisory_ids: verified.advisory_ids,
    measurements: {
      mrtd: toHex(td.mrTd),
      rtmr0: toHex(td.rtMr0),
      rtmr1: toHex(td.rtMr1),
      rtmr2: toHex(td.rtMr2),
      rtmr3: toHex(td.rtMr3),
    },
    report_data_prefix: toHex(td.reportData.slice(0, 32)),
  };
}

/** A run is tied to the transaction only through inputs and outputs whose hashes it attests. */
export function attestedPayloads(e: ExecutionEvidence): {
  input: string | null;
  output: string | null;
} {
  const att = e.attestation;
  if (!att) return { input: null, output: null };
  return {
    input: e.inputs.find((i) => inputHash(i) === att.input_hash) ?? null,
    output: e.outputs.find((o) => outputHash(o) === att.output_hash) ?? null,
  };
}

export function parseJson(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
