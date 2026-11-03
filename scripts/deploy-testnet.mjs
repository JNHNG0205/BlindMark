// Deploys the BlindMark contract to testnet: creates its account if needed, deploys new code
// only when it changed, and initializes it once. Usage: node scripts/deploy-testnet.mjs <wasm>
import { readFileSync } from "node:fs";
import {
  CONTRACT_ID,
  NEAR,
  OUTLAYER_ID,
  ROOT_ID,
  account,
  call,
  exists,
  provider,
  publicKey,
  rootAccount,
  sha256Base58,
  view,
} from "./lib/near.mjs";

const wasmPath = process.argv[2];
if (!wasmPath)
  throw new Error(
    "usage: node scripts/deploy-testnet.mjs <path to contract wasm>",
  );
const code = readFileSync(wasmPath);
const contract = account(CONTRACT_ID);

if (!(await exists(CONTRACT_ID))) {
  if (!CONTRACT_ID.endsWith(`.${ROOT_ID}`)) {
    throw new Error(
      `${CONTRACT_ID} does not exist and is not a subaccount of ${ROOT_ID}.`,
    );
  }
  // Code storage costs about 1 NEAR per 100 KB.
  const balance = BigInt(Math.ceil(code.length / 100_000) + 1) * NEAR;
  const tx = await rootAccount.createSubAccount({
    accountOrPrefix: CONTRACT_ID,
    publicKey,
    nearToTransfer: balance,
  });
  console.log(`created ${CONTRACT_ID}: ${tx.transaction.hash}`);
}

const state = await provider.viewAccount({
  accountId: CONTRACT_ID,
  blockQuery: { finality: "optimistic" },
});
if (state.code_hash === sha256Base58(code)) {
  console.log("code unchanged, not redeploying");
} else {
  const tx = await contract.deployContract(code);
  console.log(`deployed ${code.length} bytes: ${tx.transaction.hash}`);
}

let initialized = true;
try {
  await view(CONTRACT_ID, "get_backends");
} catch {
  initialized = false;
}
if (initialized) {
  console.log("already initialized");
} else {
  await call(contract, CONTRACT_ID, "new", {
    admin: ROOT_ID,
    outlayer_contract: OUTLAYER_ID,
    treasury: ROOT_ID,
    platform_fee_bps: 500,
  });
}
console.log(
  `BlindMark contract: ${CONTRACT_ID} (admin and treasury ${ROOT_ID}, OutLayer ${OUTLAYER_ID})`,
);
