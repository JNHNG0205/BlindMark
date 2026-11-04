// Public frontend config. Only NEXT_PUBLIC_* values belong here; nothing secret.
const NETWORKS = {
  testnet: {
    rpc: "https://rpc.testnet.fastnear.com",
    explorer: "https://testnet.nearblocks.io",
    contract: "blindmark.blindmark-jh-fe87ee.testnet",
    outlayerContract: "outlayer.testnet",
    outlayerApi: "https://testnet-api.outlayer.ai",
    fastfsHost: "test.fastfs.io",
  },
  mainnet: {
    rpc: "https://rpc.mainnet.fastnear.com",
    explorer: "https://nearblocks.io",
    contract: "",
    outlayerContract: "outlayer.near",
    outlayerApi: "https://api.outlayer.ai",
    fastfsHost: "main.fastfs.io",
  },
} as const;

export type NetworkId = keyof typeof NETWORKS;

export const NETWORK_ID: NetworkId =
  process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
const network = NETWORKS[NETWORK_ID];

export const RPC_URL = network.rpc;
export const EXPLORER_URL = network.explorer;
export const OUTLAYER_CONTRACT_ID = network.outlayerContract;
export const OUTLAYER_API_URL = network.outlayerApi;
export const FASTFS_HOST = network.fastfsHost;
export const CONTRACT_ID =
  process.env.NEXT_PUBLIC_BLINDMARK_CONTRACT_ID || network.contract;
