#!/usr/bin/env node
// `blindmark verify <eval_id>`. Spec: CLAUDE.md section 10. Read-only: needs no keys.
import { parseArgs } from "node:util";
import { leafHash, toHex } from "@blindmark/shared";
import { runChecks, type ChainData, type OffChainData } from "./checks.js";

const NETWORKS: Record<string, { rpc: string; contract?: string }> = {
  testnet: {
    rpc: "https://rpc.testnet.fastnear.com",
    contract: "blindmark.blindmark-jh-fe87ee.testnet",
  },
  mainnet: { rpc: "https://rpc.mainnet.fastnear.com" },
};

const USAGE =
  "usage: blindmark verify <eval_id> [--network testnet] [--contract <account>] [--rpc <url>] [--fetch-shards] [--json]";

function usage(): never {
  console.error(USAGE);
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      network: { type: "string", default: "testnet" },
      contract: { type: "string" },
      rpc: { type: "string" },
      "fetch-shards": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
} catch {
  usage();
}
const { values, positionals } = parsed;
const [command, evalArg] = positionals;
if (command !== "verify" || !evalArg || !/^\d+$/.test(evalArg)) usage();
const network = NETWORKS[values.network];
if (!network) usage();
const contract =
  values.contract ?? process.env.BLINDMARK_CONTRACT_ID ?? network.contract;
if (!contract) {
  console.error(`--contract is required on ${values.network}`);
  process.exit(2);
}
const rpc = values.rpc ?? network.rpc;
const evalId = Number(evalArg);

async function view<T>(method: string, args: object): Promise<T> {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "verify",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contract,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const body = (await response.json()) as {
    result?: { result?: number[] };
    error?: unknown;
  };
  if (!body.result?.result) {
    throw new Error(
      `${method}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`,
    );
  }
  return JSON.parse(Buffer.from(body.result.result).toString("utf8")) as T;
}

async function fetchShardHashes(
  uris: string[],
): Promise<OffChainData["shard_hashes"]> {
  return Promise.all(
    uris.map(async (uri) => {
      try {
        const response = await fetch(uri);
        if (!response.ok)
          return { error: `HTTP ${response.status} from ${uri}` };
        return toHex(leafHash(new Uint8Array(await response.arrayBuffer())));
      } catch {
        return { error: `could not fetch ${uri}` };
      }
    }),
  );
}

let data: ChainData;
try {
  const certificate = await view<ChainData["certificate"]>("get_certificate", {
    eval_id: evalId,
  });
  const evaluation = await view<ChainData["evaluation"]>("get_eval", {
    id: evalId,
  });
  const benchmarkId = certificate?.benchmark_id ?? evaluation?.benchmark_id;
  data = {
    eval_id: evalId,
    certificate,
    evaluation,
    benchmark:
      benchmarkId === undefined
        ? null
        : await view<ChainData["benchmark"]>("get_benchmark", {
            id: benchmarkId,
          }),
    backends: await view<ChainData["backends"]>("get_backends", {}),
  };
} catch (error) {
  console.error(
    `could not read ${contract} on ${values.network}: ${(error as Error).message}`,
  );
  process.exit(1);
}

const offChain: OffChainData = {};
if (values["fetch-shards"] && data.benchmark) {
  offChain.shard_hashes = await fetchShardHashes(data.benchmark.shard_uris);
}
const results = runChecks(data, offChain);
const failed = results.some((r) => r.status === "FAIL");

if (values.json) {
  console.log(
    JSON.stringify(
      {
        eval_id: evalId,
        network: values.network,
        contract,
        ok: !failed,
        checks: results,
        certificate: data.certificate,
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `BlindMark certificate check: eval ${evalId} on ${contract} (${values.network})`,
  );
  const cert = data.certificate;
  if (cert) {
    console.log(
      `  model ${cert.model_id}, tier ${cert.trust_tier}, score ${(cert.score_bps / 100).toFixed(2)}% ` +
        `[${(cert.ci_low_bps / 100).toFixed(2)}%, ${(cert.ci_high_bps / 100).toFixed(2)}%] on ${cert.n_items} items`,
    );
  }
  console.log("");
  for (const r of results) {
    console.log(`${r.status.padEnd(5)} ${r.id}. ${r.name}`);
    for (const detail of r.details) console.log(`        ${detail}`);
  }
  const count = (s: string) => results.filter((r) => r.status === s).length;
  console.log("");
  console.log(
    `${failed ? "FAILED" : "NO FAILURES"}: ${count("PASS")} pass, ${count("WARN")} warn, ${count("FAIL")} fail. ` +
      "WARN means not verified.",
  );
}
process.exit(failed ? 1 : 0);
