// TEST ONLY. Runs one throwaway eval end to end on testnet through OutLayer's real worker,
// using the stub grader under a `test-stub` backend. The certificate it produces means nothing.
// Usage: node scripts/e2e-testnet-stub.mjs <stub wasm path> <public https URL of that wasm>
import { readFileSync } from "node:fs";
import {
  CONTRACT_ID,
  NEAR,
  OUTLAYER_ID,
  ROOT_ID,
  call,
  provider,
  rootAccount,
  send,
  sha256Hex,
  sleep,
  view,
} from "./lib/near.mjs";

const [wasmPath, wasmUrl] = process.argv.slice(2);
if (!wasmPath || !wasmUrl?.startsWith("https://")) {
  throw new Error(
    "usage: node scripts/e2e-testnet-stub.mjs <stub wasm path> <https URL>",
  );
}
const hash = sha256Hex(readFileSync(wasmPath));
const served = sha256Hex(
  Buffer.from(await (await fetch(wasmUrl)).arrayBuffer()),
);
if (served !== hash)
  throw new Error(`the URL serves ${served}, but the local build is ${hash}`);

// 1. The OutLayer project, with the stub as a WasmUrl version so its key is the hash.
const projectName = "blindmark-test-stub";
const projectId = `${ROOT_ID}/${projectName}`;
const source = {
  WasmUrl: { url: wasmUrl, hash, build_target: "wasm32-wasip2" },
};
const project = await provider
  .callFunction({
    contractId: OUTLAYER_ID,
    method: "get_project",
    args: { project_id: projectId },
    blockQuery: { finality: "optimistic" },
  })
  .catch(() => null);
const deposit = NEAR / 10n;
if (!project) {
  await call(
    rootAccount,
    OUTLAYER_ID,
    "create_project",
    { name: projectName, source },
    { deposit },
  );
} else if (project.active_version !== hash) {
  await call(
    rootAccount,
    OUTLAYER_ID,
    "add_version",
    { project_name: projectName, source, set_active: true },
    { deposit },
  );
}

// 2. The test backend and model, clearly named so nobody mistakes them for real ones.
const backendId = `test-stub-${hash.slice(0, 8)}`;
if (
  !(await view(CONTRACT_ID, "get_backends")).some((b) => b.id === backendId)
) {
  await call(rootAccount, CONTRACT_ID, "add_backend", {
    backend: {
      id: backendId,
      kind: "OutLayer",
      measurement: hash,
      outlayer_project: projectId,
      active: true,
    },
  });
}
if (
  !(await view(CONTRACT_ID, "get_models")).some((m) => m.id === "test-model")
) {
  await call(rootAccount, CONTRACT_ID, "add_model", {
    model: { id: "test-model", tier: "C", active: true },
  });
}

// 3. A throwaway benchmark with two fake shards. Its secret profile does not exist, so OutLayer
// runs the stub without secrets, which the stub never needs.
const shardHashes = [0, 1].map((i) => leafHex(`test-stub-shard-${i}`));
const benchmarkTx = await call(
  rootAccount,
  CONTRACT_ID,
  "register_benchmark",
  {
    args: {
      version: 1,
      title: "TEST STUB: not a real benchmark",
      description:
        "Throwaway benchmark for checking the contract end to end with the stub grader.",
      grading_type: "exact",
      dataset_root: nodeHex(shardHashes[0], shardHashes[1]),
      protocol_hash: sha256Hex(Buffer.from("test-stub-protocol")),
      protocol_uri: "https://example.invalid/test-stub-protocol.json",
      shard_uris: [
        "https://example.invalid/0.bin",
        "https://example.invalid/1.bin",
      ],
      shard_hashes: shardHashes,
      item_count: 10,
      sample_items_uri: null,
      price: (NEAR / 100n).toString(),
      secret_ref: { owner: ROOT_ID, profile: "test-stub-none" },
      max_evals_per_model: 100,
      cooldown_ns: "0",
    },
  },
  { deposit: NEAR / 10n },
);
const benchmarkId = Number(returnValue(benchmarkTx));
console.log(`benchmark ${benchmarkId}`);

// 4. Request the eval without waiting: the transaction stays open until the worker answers.
const storage = BigInt(
  await view(CONTRACT_ID, "eval_storage_deposit", { shard_count: 2 }),
);
const evalDeposit =
  NEAR / 100n + 6n * 20_000_000_000_000_000_000_000n + storage;
const requestHash = await send(
  rootAccount,
  CONTRACT_ID,
  "request_eval",
  {
    benchmark_id: benchmarkId,
    model_id: "test-model",
    backend_id: backendId,
  },
  { deposit: evalDeposit },
);
const evalId = await waitForReturnValue(requestHash);
console.log(`eval ${evalId}`);

// 5. Move it along until it is certified or failed, like a frontend would.
const started = Date.now();
let lastSent = 0;
while (Date.now() - started < 10 * 60_000) {
  await sleep(4000);
  const evaluation = await view(CONTRACT_ID, "get_eval", { id: evalId });
  const done = evaluation.partials.filter((p) => p !== null).length;
  console.log(
    `  ${Math.round((Date.now() - started) / 1000)}s: ${evaluation.status}, ${done}/2 shards, retries left ${evaluation.retries_left}`,
  );
  if (evaluation.status === "Certified" || evaluation.status === "Failed") {
    if (evaluation.status === "Certified") {
      console.log(
        JSON.stringify(
          await view(CONTRACT_ID, "get_certificate", { eval_id: evalId }),
          null,
          2,
        ),
      );
    }
    process.exit(evaluation.status === "Certified" ? 0 : 1);
  }
  const canSend =
    evaluation.status === "Dispatching" ||
    (evaluation.status === "Grading" &&
      (evaluation.retry_shards.length > 0 || done === 2));
  if (canSend && Date.now() - lastSent > 15_000) {
    await send(rootAccount, CONTRACT_ID, "continue_dispatch", {
      eval_id: evalId,
    });
    lastSent = Date.now();
  }
}
throw new Error("timed out after 10 minutes");

function leafHex(text) {
  return sha256Hex(Buffer.concat([Buffer.from([0]), Buffer.from(text)]));
}

function nodeHex(left, right) {
  return sha256Hex(
    Buffer.concat([
      Buffer.from([1]),
      Buffer.from(left, "hex"),
      Buffer.from(right, "hex"),
    ]),
  );
}

function returnValue(tx) {
  const value = tx.status?.SuccessValue;
  return JSON.parse(Buffer.from(value, "base64").toString());
}

async function waitForReturnValue(txHash) {
  for (let i = 0; i < 60; i++) {
    const response = await fetch(
      provider.connection?.url ?? "https://rpc.testnet.fastnear.com",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "EXPERIMENTAL_tx_status",
          params: {
            tx_hash: txHash,
            sender_account_id: ROOT_ID,
            wait_until: "NONE",
          },
        }),
      },
    ).then((r) => r.json());
    const own = response.result?.receipts_outcome?.find(
      (r) =>
        r.outcome.executor_id === CONTRACT_ID &&
        r.outcome.status.SuccessValue !== undefined,
    );
    if (own)
      return JSON.parse(
        Buffer.from(own.outcome.status.SuccessValue, "base64").toString(),
      );
    const failure = response.result?.receipts_outcome?.find(
      (r) => r.outcome.status.Failure,
    );
    if (failure)
      throw new Error(
        `request_eval failed: ${JSON.stringify(failure.outcome.status.Failure)}`,
      );
    await sleep(2000);
  }
  throw new Error("request_eval did not execute");
}
