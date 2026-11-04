# BlindMark

BlindMark is a private AI benchmarking platform on NEAR. A neutral grader in a TEE scores models against secret test sets, and each result is a public certificate on NEAR.

**Status: in progress.** The contract, web app and verifier work on testnet. The real grader and agent are not finished: the grader is a stub that fails closed, so the only certificate on testnet (eval 0) comes from a clearly labelled test-only stub backend and its score means nothing. The full README, with the sections listed in `CLAUDE.md` section 18, comes with the working system.

## Try it

Everything below runs on NEAR testnet and spends only testnet NEAR. Until the real grader is registered, the only backend is the test-only stub, so evals finish with a meaningless score of 0.

1. Run the web app: `pnpm install`, then `pnpm --filter @blindmark/web dev`, and open `http://localhost:3000`. You see the benchmark explorer, read live from `blindmark.blindmark-jh-fe87ee.testnet`.
2. Connect a testnet wallet with the button in the header (Sender, OKX, Bitget or Nightly extension). You see your account id in the header.
3. Register a benchmark at `/benchmarks/new`. Pick a JSONL file of items (section 5.1 of `CLAUDE.md`) and a protocol JSON. You see the shards encrypted in your browser and the Merkle root. Then:
   - **Upload with wallet.** You see one FastFS transaction per file and then a PASS line for each file once it is re-fetched and re-hashed.
   - **Store K in OutLayer.** K is encrypted in the browser to the OutLayer keystore, and you see `get_secrets` confirm the stored ciphertext.
   - **Register.** You see the new benchmark id.

   K and the plaintext items never leave the browser unencrypted.
4. Open the benchmark at `/benchmarks/<id>` and press "Request evaluation". You land on `/evals/<id>` and see shards move from dispatched to graded, then aggregation, then a certificate link. If a run is lost, the page offers "Continue dispatch"; after the 6 hour deadline or a failure it offers a refund.
5. Open the certificate at `/certificates/<id>`. You see the score with its 95% interval, the cost, the trust tier, each hop of the data path with a PASS, WARN or FAIL badge, and the verify command for the next section.
6. Open `/leaderboard`. You see each model's latest certificate per benchmark and its number of attempts, never its best.

## Verify a certificate

Anyone can check a certificate without keys or trust in this web app:

```bash
pnpm install && pnpm --filter @blindmark/verifier build
pnpm blindmark verify <eval_id>        # --network testnet|mainnet, --contract <account>, --json
```

It reads the contract over plain JSON-RPC and OutLayer's public API, and runs 7 checks:

1. the certificate exists
2. its commitments match the benchmark
3. the Merkle root recomputes from the shard hashes
4. OutLayer ran the certified grader build, with the eval's nonce, for every shard and the aggregation
5. each run's Intel TDX quote verifies to Intel's root and commits to that code, input and output
6. the model evidence
7. the score interval

It exits non-zero on any FAIL. WARN means "not verified", never "verified". Add `--fetch-shards` to re-hash the ciphertexts.

Output for eval 0, the test-only stub certificate, on 2026-11-04. Check 7 fails because the stub reports an interval of 0 to 0 instead of the Wilson interval, which shows the verifier catching a wrong score:

```text
BlindMark certificate check: eval 0 on blindmark.blindmark-jh-fe87ee.testnet (testnet)
  model test-model, tier C, score 0.00% [0.00%, 0.00%] on 10 items

PASS  1. Certificate exists
PASS  2. Commitments
PASS  3. Merkle
WARN  4. Grader build
        backend test-stub-94149ba5 is a test-only backend; this score means nothing
        shard 0: OutLayer job 16517 ran 94149ba53b... (tx FkGbBjfj4Y...)
        ...
PASS  5. Intel attestation
        3 of 3 runs: Intel-signed TDX quote, report_data commits to the attested code, input and output, worker build approved on chain
WARN  6. Model evidence
        evidence bundles not fetched: storage not decided (spike S5); 0 calls counted as verified
FAIL  7. Statistics
        certificate says 0.00% [0.00%, 0.00%], 0/10 gives 0.00% [0.00%, 27.75%]

FAILED: 4 pass, 2 warn, 1 fail. WARN means not verified.
```

The output for a certificate from the real grader replaces this once one exists.

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
