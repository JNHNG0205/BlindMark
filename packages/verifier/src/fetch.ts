// Network side of the verifier: collects OutLayer jobs, attestations, transactions and Intel
// collateral for one eval, so `runChecks` can stay pure. Used by the CLI and the web
// certificate page. Read-only; needs no keys.
import { Quote, utils, type Collateral } from "@phala/dcap-qvl";
import { toHex } from "@blindmark/shared";
import type {
  AttestationRecord,
  ExecutionEvidence,
  Measurements,
} from "./attestation.js";
import type { ChainData, OffChainData } from "./checks.js";

export interface OutLayerEndpoints {
  /** OutLayer coordinator API. */
  api: string;
  /** Archival RPC: dispatch transactions can be older than ordinary nodes keep. */
  archivalRpc: string;
  /** Plain RPC, for the register contract view. */
  rpc: string;
  outlayerContract: string;
  /** Holds the approved worker measurements. */
  registerContract: string;
}

export const OUTLAYER_ENDPOINTS: Record<string, OutLayerEndpoints> = {
  testnet: {
    api: "https://testnet-api.outlayer.ai",
    archivalRpc: "https://archival-rpc.testnet.fastnear.com",
    rpc: "https://rpc.testnet.fastnear.com",
    outlayerContract: "outlayer.testnet",
    registerContract: "worker.outlayer.testnet",
  },
  mainnet: {
    api: "https://api.outlayer.ai",
    archivalRpc: "https://archival-rpc.mainnet.fastnear.com",
    rpc: "https://rpc.mainnet.fastnear.com",
    outlayerContract: "outlayer.near",
    registerContract: "worker.outlayer.near",
  },
};

interface Job {
  job_id: number;
  transaction_hash: string | null;
  user_account_id: string | null;
  created_at: string;
  status: string;
}

const PAGE = 100;
const MAX_PAGES = 30;
const PARALLEL = 4;
/** Jobs are created when a worker picks a request up, shortly after dispatch. */
const WINDOW_BEFORE_MS = 60_000;
const WINDOW_AFTER_MS = 10 * 60_000;

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  if (!text) return null;
  return JSON.parse(text);
}

async function rpcCall(url: string, method: string, params: unknown) {
  const body = (await getJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "verify", method, params }),
  })) as { result?: unknown; error?: unknown };
  if (body.error || body.result === undefined)
    throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 200)}`);
  return body.result;
}

/** Runs `fn` over `items` with at most PARALLEL in flight. */
async function pool<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Inputs and OutLayer return values carried by one transaction (as outlayer-verify reads them). */
async function txPayloads(
  at: OutLayerEndpoints,
  hash: string,
  sender: string,
): Promise<{ inputs: string[]; outputs: string[] }> {
  const result = (await rpcCall(at.archivalRpc, "EXPERIMENTAL_tx_status", [
    hash,
    sender,
  ])) as {
    receipts_outcome?: {
      outcome: {
        executor_id: string;
        logs: string[];
        status: { SuccessValue?: string };
      };
    }[];
  };
  const inputs: string[] = [];
  const outputs: string[] = [];
  for (const receipt of result.receipts_outcome ?? []) {
    for (const log of receipt.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const event = JSON.parse(log.slice("EVENT_JSON:".length)) as {
          event?: string;
          data?: { request_data?: string }[];
        };
        if (event.event !== "execution_requested") continue;
        const request = JSON.parse(event.data?.[0]?.request_data ?? "null") as {
          input_data?: unknown;
        } | null;
        if (typeof request?.input_data === "string")
          inputs.push(request.input_data);
      } catch {
        // Not an event we read.
      }
    }
    const value = receipt.outcome.status.SuccessValue;
    if (receipt.outcome.executor_id === at.outlayerContract && value) {
      outputs.push(Buffer.from(value, "base64").toString("utf8"));
    }
  }
  return { inputs, outputs };
}

/** Reads the platform id and measurements from a quote without trusting them; check 5 verifies. */
function quoteFacts(quoteBase64: string): {
  fmspc: string;
  measurements: Measurements;
} {
  const bytes = Buffer.from(quoteBase64, "base64");
  const quote = Quote.parse(bytes);
  const certs = utils.extractCerts(Buffer.from(quote.rawCertChain()));
  if (!certs[0]) throw new Error("quote carries no PCK certificate");
  const fmspc = toHex(utils.getFmspc(utils.getIntelExtension(certs[0])));
  const td = quote.report.asTd10() ?? quote.report.asTd15()?.base ?? null;
  if (!td) throw new Error("not a TDX quote");
  return {
    fmspc,
    measurements: {
      mrtd: toHex(td.mrTd),
      rtmr0: toHex(td.rtMr0),
      rtmr1: toHex(td.rtMr1),
      rtmr2: toHex(td.rtMr2),
      rtmr3: toHex(td.rtMr3),
    },
  };
}

async function measurementsApproved(
  at: OutLayerEndpoints,
  measurements: Measurements,
): Promise<boolean> {
  const result = (await rpcCall(at.rpc, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: at.registerContract,
    method_name: "is_measurements_approved",
    args_base64: Buffer.from(JSON.stringify({ measurements })).toString(
      "base64",
    ),
  })) as { result?: number[] };
  return JSON.parse(Buffer.from(result.result ?? []).toString("utf8")) === true;
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Collects the grader project's OutLayer jobs during the eval, keeps those whose transaction
 * carries an input for this eval, and fetches their attestations, Intel collateral and the
 * register contract's approval of the worker build.
 */
export async function fetchOutLayerEvidence(
  data: ChainData,
  at: OutLayerEndpoints,
): Promise<NonNullable<OffChainData["outlayer"]>> {
  const { certificate: cert, evaluation } = data;
  if (!cert || !evaluation) return { error: "no certified eval" };
  const backend = data.backends.find((b) => b.id === cert.backend_id);
  if (!backend?.outlayer_project)
    return { error: `backend ${cert.backend_id} names no OutLayer project` };
  const project = backend.outlayer_project;
  const from =
    Number(BigInt(evaluation.created_at_ns) / 1_000_000n) - WINDOW_BEFORE_MS;
  const to = Number(BigInt(cert.issued_at_ns) / 1_000_000n) + WINDOW_AFTER_MS;

  try {
    const jobs: Job[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = (await getJson(
        `${at.api}/public/jobs?project=${encodeURIComponent(project)}&limit=${PAGE}&offset=${page * PAGE}`,
      )) as Job[] | null;
      if (!Array.isArray(batch)) break;
      jobs.push(...batch);
      const oldest = batch.at(-1);
      if (
        batch.length < PAGE ||
        !oldest ||
        Date.parse(oldest.created_at) < from
      )
        break;
    }
    const inWindow = jobs.filter((j) => {
      const t = Date.parse(j.created_at);
      return t >= from && t <= to && j.transaction_hash && j.user_account_id;
    });

    // One transaction can dispatch several runs; fetch each once.
    const txs = new Map<string, string>();
    for (const j of inWindow) txs.set(j.transaction_hash!, j.user_account_id!);
    const payloads = new Map<string, { inputs: string[]; outputs: string[] }>();
    await pool([...txs], async ([hash, sender]) => {
      try {
        payloads.set(hash, await txPayloads(at, hash, sender));
      } catch {
        payloads.set(hash, { inputs: [], outputs: [] });
      }
    });

    const mentionsEval = (inputs: string[]) =>
      inputs.some((i) => {
        try {
          return (
            (JSON.parse(i) as { eval_id?: unknown }).eval_id === cert.eval_id
          );
        } catch {
          return false;
        }
      });
    const relevant = inWindow.filter((j) =>
      mentionsEval(payloads.get(j.transaction_hash!)?.inputs ?? []),
    );

    const collaterals = new Map<
      string,
      Promise<ExecutionEvidence["collateral"]>
    >();
    const approvals = new Map<string, Promise<boolean>>();
    const executions = await pool(
      relevant,
      async (job): Promise<ExecutionEvidence> => {
        const { inputs, outputs } = payloads.get(job.transaction_hash!)!;
        const evidence: ExecutionEvidence = {
          job_id: job.job_id,
          transaction_hash: job.transaction_hash!,
          attestation: null,
          inputs,
          outputs,
        };
        try {
          evidence.attestation = (await getJson(
            `${at.api}/attestations/${job.job_id}`,
          )) as AttestationRecord | null;
        } catch {
          return evidence; // OutLayer published none: lost or failed run.
        }
        const att = evidence.attestation;
        if (!att?.tdx_quote) return { ...evidence, attestation: null };
        let facts;
        try {
          facts = quoteFacts(att.tdx_quote);
        } catch (error) {
          // Check 5 reports the unparseable quote itself.
          evidence.collateral = { error: message(error) };
          return evidence;
        }
        const collateralKey = `${facts.fmspc}@${att.timestamp}`;
        if (!collaterals.has(collateralKey)) {
          collaterals.set(
            collateralKey,
            getJson(
              `${at.api}/public/collateral?fmspc=${facts.fmspc}&at=${att.timestamp}`,
            ).then(
              (body) => {
                const b = body as {
                  collateral?: string;
                  covers_requested_time?: boolean;
                };
                if (typeof b?.collateral !== "string")
                  return { error: "no collateral in the response" };
                return {
                  body: JSON.parse(b.collateral) as Collateral,
                  covers_time: b.covers_requested_time === true,
                };
              },
              (error) => ({ error: message(error) }),
            ),
          );
        }
        evidence.collateral = await collaterals.get(collateralKey);
        const key = JSON.stringify(facts.measurements);
        if (!approvals.has(key))
          approvals.set(key, measurementsApproved(at, facts.measurements));
        try {
          evidence.approval = {
            measurements: facts.measurements,
            approved: await approvals.get(key)!,
          };
        } catch (error) {
          evidence.approval = { error: message(error) };
        }
        return evidence;
      },
    );
    return { executions };
  } catch (error) {
    return { error: message(error) };
  }
}
