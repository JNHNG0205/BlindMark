# BlindMark

BlindMark is a private AI benchmarking platform on NEAR. A neutral grader in a TEE scores models against secret test sets, and each result is a public certificate on NEAR.

**Status: scaffold.** Nothing runs end to end yet. The grader, verifier and agent are stubs that exit non-zero, so they cannot produce a score or a passing check. The full README, with the sections listed in `CLAUDE.md` section 18, comes with the working system.

## Development

Requires rustup, Node 24 or later and pnpm 10. `rust-toolchain.toml` selects the Rust version and targets.

```bash
pnpm install
cargo test -p blindmark-types
cargo test -p blindmark-contract
cargo check -p blindmark-contract --target wasm32-unknown-unknown
./scripts/build-wasm.sh
pnpm build
pnpm --filter @blindmark/web dev
```

The specs and the rules for working in this repo are in `CLAUDE.md`.
