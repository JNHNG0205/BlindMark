#!/usr/bin/env bash
# Builds and deploys the BlindMark contract to testnet. Refuses any other network (CLAUDE.md
# section 2). Needs .env (see .env.example) and `cargo near`.
set -euo pipefail

cd "$(dirname "$0")/.."

cargo near build non-reproducible-wasm --manifest-path contracts/blindmark/Cargo.toml
node scripts/deploy-testnet.mjs target/near/blindmark_contract/blindmark_contract.wasm
