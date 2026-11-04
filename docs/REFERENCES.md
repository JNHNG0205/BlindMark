# References

The background research and evidence that `CLAUDE.md` points to have not been added yet. This file only lists the links `CLAUDE.md` already cites.

- NEAR AI Cloud gateway: https://cloud-api.near.ai
- NEAR AI model catalog: https://cloud-api.near.ai/v1/models
- OutLayer NEAR integration docs: https://app.outlayer.ai/docs/near-integration

## OutLayer (verifier checks 4 and 5, K secret, shard storage)

Read on 2026-11-04 for Role 3 tasks T1, T4, T7 and T8.

- Secrets: https://app.outlayer.ai/docs/secrets
- TEE attestation: https://app.outlayer.ai/docs/tee-attestation
- Trust and verification: https://app.outlayer.ai/docs/trust-verification
- HTTPS API: https://app.outlayer.ai/docs/https-api
- FastFS workflow: https://app.outlayer.ai/docs/near-integration#fastfs-workflow
- OutLayer source (contract `store_secrets`, `estimate_storage_cost`, `get_secrets`; keystore ECIES in `keystore-worker/src/crypto.rs`): https://github.com/out-layer/outlayer
- OutLayer dashboard source (Secrets page flow, `lib/ecies.ts`, attestation verification): https://github.com/out-layer/dashboard
- outlayer-verify (task hash format, V1 cut-off 1769784939, payload hashing rules): https://github.com/out-layer/outlayer-verify
- Intel DCAP quote verification in JS: https://www.npmjs.com/package/@phala/dcap-qvl (source https://github.com/Phala-Network/dcap-qvl)

## FastFS

- Upload format (Borsh `FastfsData::Simple`): https://hackmd.io/@fastnear/fastfs-docs
- `__fastdata` protocol: https://hackmd.io/@fastnear/__fastdata
- OutLayer CLI upload implementation (hosts `main.fastfs.io`, `test.fastfs.io`): https://docs.rs/crate/outlayer-cli/latest/source/src/commands/upload.rs
