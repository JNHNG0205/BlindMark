# BlindMark demo script

The script for the demo video (Role 3 plan, T19). Everything runs on NEAR testnet. Aim for about 3 minutes. Each step says what to do and what the viewer must see.

**Not ready to record yet.** Steps 3 to 6 need Role 2's real grader registered as a backend, and step 7 needs Role 2. Today the only backend is the test-only stub, which must never appear in the demo.

## Before recording

- [ ] Real grader backend registered and active on `blindmark.blindmark-jh-fe87ee.testnet` (Role 1 and Role 2). `get_backends` shows no stub as active, or the stub is not selected.
- [ ] A Confidential TEE model on the allowlist (`get_models`).
- [ ] `math-v1` items ready in `benchmarks/math-v1/private/` (Role 4). They stay local; never commit, show or upload them in plaintext.
- [ ] Two testnet wallets in browser extensions: the **owner** and the **model team**, each with about 5 testnet NEAR.
- [ ] `pnpm install`, `pnpm build`, then `pnpm --filter @blindmark/web start`, and open `http://localhost:3000`.
- [ ] A terminal with the repo open, font large enough to read.
- [ ] One eval run through the whole script once beforehand, so the timings are known. Grading takes minutes; cut the waiting in editing.

## Script

### 1. The problem (20 s, explorer page `/`)

Say: public benchmarks leak into training data. Keeping a test set private today means someone has to be trusted. NEAR AI Cloud runs the model in a TEE, but whoever calls the model still sees the questions. BlindMark makes a grader in a second TEE the caller.

Show: the trust chain table and the "How it works" diagram on `/`.

### 2. The owner registers a benchmark (40 s, `/benchmarks/new`, owner wallet)

1. Connect the owner wallet.
2. Choose the `math-v1` JSONL and protocol. Show the item count and that encryption happens in the browser (step 2: shard count, Merkle root).
3. Step 3 "Upload with wallet": approve the FastFS transactions. Show every file turn PASS after the re-hash.
4. Step 4: store K in OutLayer. Show the access condition (approved grader hash AND only the BlindMark contract as caller), then the `get_secrets` confirmation.
5. Step 5: register. Show the new benchmark id.

Say: only ciphertext left the browser. K is readable only by the approved grader build, and only when called through the contract.

### 3. The model team requests an eval (20 s, `/benchmarks/<id>`, model team wallet)

1. Switch to the model team wallet.
2. Show the public sample items, the price and the probing limits.
3. Press "Request evaluation" with the Confidential TEE model and the real backend, and approve. Show the deposit breakdown: price, compute budget, storage.

### 4. Live grading (20 s after cuts, `/evals/<id>`)

Show shards moving from dispatched to graded, then aggregation, then the certificate link. Say: each shard runs in Intel TDX on OutLayer; per-shard scores are sealed, and only the aggregate is published.

### 5. The certificate (30 s, `/certificates/<id>`)

Show the score with its 95% interval, the cost, the trust tier A label, and each data path hop with its badge. Point out the grader build hash and the dataset root.

### 6. Anyone can verify (30 s, terminal)

```bash
pnpm blindmark verify <eval_id>
```

Show the checks scrolling: the commitments match, the Merkle root recomputes, OutLayer ran the certified build for every shard, and the Intel TDX quotes verify. Say that WARN means not verified, and read out any WARN with its reason (check 6 if model evidence is still under the S5 fallback).

Then show a tampered certificate failing: the altered-score fixture test.

```bash
pnpm vitest run packages/verifier/test/checks.test.ts -t "altered score"
```

### 7. Tamper test (30 s, with Role 2)

Shown from Role 2's recording or live, per the grader spec:

1. One line of the grader is changed (for example, it prints an item), rebuilt and deployed as a new OutLayer version.
2. Run it against the benchmark's K: OutLayer refuses the secret, because the WASM hash differs. Show the refusal.
3. Show that the tampered version cannot produce a certificate through the contract: dispatches are pinned to the registered measurement, so the contract never runs it.

### 8. Close (10 s, `/leaderboard`)

Show the leaderboard: latest certificate per model, attempts counted, statistical ties labelled. Say: the owner never saw the answers, the model team never saw the questions, and the score is public and checkable.

## After recording

- Do not show `.env`, private keys, K (the wizard's "Reveal K" stays closed) or any plaintext item on screen.
- Upload the video only after the human approves it (hard rule 1).
