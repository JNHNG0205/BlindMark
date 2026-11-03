// Public frontend config. Only NEXT_PUBLIC_* values belong here; nothing secret.
const NETWORKS = {
  testnet: {
    rpc: "https://rpc.testnet.fastnear.com",
    explorer: "https://testnet.nearblocks.io",
    contract: "blindmark.blindmark-jh-fe87ee.testnet",
  },
  mainnet: {
    rpc: "https://rpc.mainnet.fastnear.com",
    explorer: "https://nearblocks.io",
    contract: "",
  },
} as const;

export type NetworkId = keyof typeof NETWORKS;

export const NETWORK_ID: NetworkId =
  process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
const network = NETWORKS[NETWORK_ID];

export const RPC_URL = network.rpc;
export const EXPLORER_URL = network.explorer;
export const CONTRACT_ID =
  process.env.NEXT_PUBLIC_BLINDMARK_CONTRACT_ID || network.contract;
