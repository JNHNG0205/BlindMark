// Read-only contract views over JSON-RPC. Works on the server and in the browser.
import type {
  Backend,
  Benchmark,
  Certificate,
  Eval,
  ModelInfo,
  Usage,
} from "@blindmark/shared";
import { CONTRACT_ID, RPC_URL } from "./config";

function toBase64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

export async function view<T>(method: string, args: object = {}): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: method,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: CONTRACT_ID,
        method_name: method,
        args_base64: toBase64(JSON.stringify(args)),
      },
    }),
  });
  const body = (await response.json()) as {
    result?: { result?: number[] };
    error?: unknown;
  };
  if (!body.result?.result) {
    throw new Error(
      `${method} failed: ${JSON.stringify(body.error ?? body).slice(0, 200)}`,
    );
  }
  return JSON.parse(
    new TextDecoder().decode(Uint8Array.from(body.result.result)),
  ) as T;
}

const PAGE = 50;

export async function listBenchmarks(): Promise<Benchmark[]> {
  const all: Benchmark[] = [];
  for (let from = 0; ;) {
    const page = await view<Benchmark[]>("list_benchmarks", {
      from,
      limit: PAGE,
    });
    all.push(...page);
    const last = page.at(-1);
    if (page.length < PAGE || !last) return all;
    from = last.id + 1;
  }
}

export async function listCertificates(
  benchmarkId: number,
): Promise<Certificate[]> {
  const all: Certificate[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await view<Certificate[]>("list_certificates", {
      benchmark_id: benchmarkId,
      from,
      limit: PAGE,
    });
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

export const getBenchmark = (id: number) =>
  view<Benchmark | null>("get_benchmark", { id });
export const getEval = (id: number) => view<Eval | null>("get_eval", { id });
export const getCertificate = (evalId: number) =>
  view<Certificate | null>("get_certificate", { eval_id: evalId });
export const getBackends = () => view<Backend[]>("get_backends");
export const getModels = () => view<ModelInfo[]>("get_models");
export const getUsage = (benchmarkId: number, modelId: string) =>
  view<Usage | null>("get_usage", {
    benchmark_id: benchmarkId,
    model_id: modelId,
  });
export const getEvalStorageDeposit = (shardCount: number) =>
  view<string>("eval_storage_deposit", { shard_count: shardCount });

/**
 * The lowest eval id that does not exist yet. Ids are sequential, so this searches upwards
 * for a missing id and then bisects. Lets the UI find a new eval without waiting for the
 * `request_eval` transaction, which stays open until OutLayer answers.
 */
export async function nextEvalId(): Promise<number> {
  if (!(await getEval(0))) return 0;
  // Invariant: `low` exists and `high` does not.
  let low = 0;
  let high = 1;
  while (await getEval(high)) {
    low = high;
    high *= 2;
  }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (await getEval(mid)) low = mid;
    else high = mid;
  }
  return high;
}

/** Guess of the id `register_benchmark` will assign next. Another registration can take it. */
export async function predictNextBenchmarkId(): Promise<number> {
  const last = (await listBenchmarks()).at(-1);
  return last ? last.id + 1 : 0;
}
