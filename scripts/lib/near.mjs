// Testnet helpers for the scripts. Keys come from the gitignored .env and are never printed.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function loadEnv() {
  const env = { ...process.env };
  let text;
  try {
    text = readFileSync(`${repoRoot}.env`, "utf8");
  } catch {
    throw new Error("No .env found. Copy .env.example to .env and fill it in.");
  }
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#") && env[line.slice(0, i)] === undefined) {
      env[line.slice(0, i)] = line.slice(i + 1).trim();
    }
  }
  return env;
}

export const env = loadEnv();

// Mainnet needs the human's explicit confirmation (CLAUDE.md section 2), so these scripts
// refuse anything but testnet.
if (env.NEAR_NETWORK !== "testnet") {
  throw new Error(`NEAR_NETWORK must be "testnet", got "${env.NEAR_NETWORK}".`);
}
for (const name of ["NEAR_ACCOUNT_ID", "NEAR_PRIVATE_KEY"]) {
  if (!env[name]) throw new Error(`${name} is missing from .env.`);
}

export const ROOT_ID = env.NEAR_ACCOUNT_ID;
export const CONTRACT_ID = env.BLINDMARK_CONTRACT_ID || `blindmark.${ROOT_ID}`;
export const OUTLAYER_ID = env.OUTLAYER_CONTRACT_ID || "outlayer.testnet";
export const provider = new JsonRpcProvider({
  url: env.NEAR_RPC_URL || "https://rpc.testnet.fastnear.com",
});
const signer = KeyPairSigner.fromSecretKey(env.NEAR_PRIVATE_KEY);
export const publicKey = await signer.getPublicKey();
export const rootAccount = new Account(ROOT_ID, provider, signer);
export const NEAR = 10n ** 24n;

export function account(id) {
  return new Account(id, provider, signer);
}

export async function exists(id) {
  try {
    await provider.viewAccount({
      accountId: id,
      blockQuery: { finality: "optimistic" },
    });
    return true;
  } catch {
    return false;
  }
}

export async function view(contractId, method, args = {}) {
  return provider.callFunction({
    contractId,
    method,
    args,
    blockQuery: { finality: "optimistic" },
  });
}

/** Sends a call and waits for it to finish. Do not use for calls that dispatch OutLayer runs. */
export async function call(
  signerAccount,
  contractId,
  methodName,
  args,
  { deposit = 0n, tgas = 100 } = {},
) {
  const tx = await signerAccount.callFunctionRaw({
    contractId,
    methodName,
    args,
    deposit,
    gas: BigInt(tgas) * 10n ** 12n,
  });
  return report(`${methodName}`, tx);
}

/**
 * Sends a call without waiting for it to finish. Calls that dispatch OutLayer runs stay open
 * until the worker answers, and must never be retried automatically (CLAUDE.md section 7.3).
 */
export async function send(
  signerAccount,
  contractId,
  methodName,
  args,
  { deposit = 0n, tgas = 300 } = {},
) {
  const tx = await signerAccount.callFunctionRaw({
    contractId,
    methodName,
    args,
    deposit,
    gas: BigInt(tgas) * 10n ** 12n,
    waitUntil: "INCLUDED",
  });
  const hash = tx.transaction?.hash ?? tx.transaction_outcome?.id;
  console.log(`${methodName}: sent ${hash}`);
  return hash;
}

function report(label, tx) {
  const failure = (tx.receipts_outcome ?? []).find(
    (r) => r.outcome.status.Failure,
  );
  if (failure) {
    throw new Error(
      `${label} failed: ${JSON.stringify(failure.outcome.status.Failure).slice(0, 400)}`,
    );
  }
  console.log(`${label}: ${tx.transaction.hash}`);
  return tx;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** NEAR reports code hashes as base58 sha256. */
export function sha256Base58(bytes) {
  let value = BigInt(`0x${sha256Hex(bytes)}`);
  let out = "";
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  return out;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
