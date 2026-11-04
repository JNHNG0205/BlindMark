# CLAUDE.md: BlindMark

Context file for Claude Code. Read this fully before writing code. It is the single source of truth for scope, specs, interfaces and rules. Background research, evidence and every doc link live in `docs/REFERENCES.md`.

Spec status legend used below:
- **[FIXED]**: decided, implement exactly.
- **[VERIFY]**: based on docs but not yet tested; confirm with a spike before relying on it, then update this file.
- **[TBD]**: open decision; ask the human or pick the simplest option and record it here.

---

## 1. What we are building

**BlindMark** is a private AI benchmarking platform on NEAR. Benchmark owners keep their test sets secret and get paid. Model teams get scores nobody can fake. Every result is a public certificate on NEAR.

**Problem.** Public benchmarks leak into training data, so scores stop meaning anything. Keeping a test set private today forces trust: either the model owner sees the questions, or the tester self-reports the score.

**Core insight (must be obvious in the demo and README).** NEAR AI Cloud runs models in a TEE, but it protects requests from NEAR and the infrastructure, not from the caller. Whoever calls the model sees the questions. So a **neutral grader running in a second TEE** must be the caller. Neither the owner nor the model team ever sees the other's secrets.

**Trust chain.**

| Layer | Proves | Provider |
|---|---|---|
| NEAR AI Cloud (Confidential TEE tier) | This model produced these answers; nobody saw the prompts | Existing service |
| OutLayer grader (Intel TDX, WASM) | These hidden questions, graded by this exact code, produced this score | We build |
| BlindMark NEAR contract | The certificate is public and permanent; the fee was escrowed and paid | We build |

**Hackathon.** NEAR HACKATHON, build window 2026-11-01T00:00Z to 2026-11-14T23:59Z. Tracks: `privacy` (main), `security`, `agents`, `open`. Judges include Claude Code and Codex as AI judges, who will read this repo. Idea origin: Illia Polosukhin's Oct 3 2026 idea list ("AI model evaluation on private test sets").

---

## 2. Hard rules for Claude Code

1. **Never** do these without the human's explicit confirmation in chat: `git push`, force-push, making the repo public, deploying to mainnet, signing mainnet transactions, spending mainnet tokens or paid API credits (testnet tokens are fine), posting anywhere, or submitting to `https://nearhackathon.com/api/applications`.
2. **Never commit secrets.** Keys and tokens live in `.env` (gitignored). Only `.env.example` with placeholder names is committed.
3. **Never commit private benchmark data.** Plaintext items live under `benchmarks/*/private/` (gitignored). Only generators, schemas, public sample items and ciphertext manifests are committed.
4. **Never log** plaintext items, answers, rubrics, model outputs, key K, or per-item correctness. Only aggregate counts may leave the grader.
5. **No mocks in the demo path.** Mock OutLayer or mock NEAR AI behaviour is allowed only in tests: behind the `mock` cargo feature in Rust, and behind `MOCK=1` in TypeScript test code only. Production builds must not compile mock code paths, and production code must never read `MOCK`.
6. When a **[VERIFY]** item turns out different from this file, fix the code and update this file and `AGENTS.md` in the same change.
7. Prefer small, reviewable commits with conventional commit messages (`feat(contract): ...`, `fix(grader): ...`).
8. Respect the user's writing preference for docs: no em dashes.

### Working principles

Adapted from Karpathy's coding guidelines. They favour caution over speed; use judgment on trivial tasks.

1. **Think before coding.** State assumptions before implementing. If a spec item is ambiguous or this file contradicts itself, name the problem instead of resolving it silently. Never treat a **[VERIFY]** item as fact. For a **[TBD]**, pick the simplest option and record it here, unless it affects funds, secrets, certificate validity or a **[FIXED]** item: then ask the human first.
2. **Simplicity first.** Build only what section 14 lists for the current milestone. No abstractions for single-use code, no configuration nobody asked for, no handling for impossible states. Validating untrusted input and handling promise failures are requirements, not speculation.
3. **Surgical changes.** Every changed line traces to the task. Stay inside the directories your task owns (section 3). Mention unrelated problems instead of fixing them, and remove only what your own change orphaned. An interface change (sections 5 to 7) updates this file, the Rust types and the TS mirror in the same change.
4. **Goal-driven execution.** Before starting, turn the task into a check: a failing test, a shared test vector, a spike pass condition (section 15) or a "done when" (section 14). State a short plan with a verify step for each part. Work is done only when the check has run and you have seen the result; report failures as failures.

---

## 3. Repository layout (scaffold)

```
blindmark/
├── CLAUDE.md                     # this file (for Claude Code)
├── AGENTS.md                     # same content for Codex; keep both in sync
├── README.md                     # judge-facing; "do X, see Y" steps; no marketing
├── .env.example                  # placeholder env var names only
├── .gitignore
├── .dockerignore
├── Cargo.toml                    # Rust workspace
├── rust-toolchain.toml
├── clippy.toml
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.mjs
├── .prettierrc.json
├── .prettierignore
├── crates/
│   └── blindmark-types/          # shared Rust types + merkle + crypto envelope + stats (std, no NEAR deps)
├── contracts/
│   └── blindmark/                # NEAR contract (near-sdk-rs)
├── grader/
│   ├── outlayer-grader/          # Part 1: OutLayer WASM (wasm32-wasip2), modes: grade, aggregate
│   └── outlayer-keyrelease/      # Part 2: OutLayer WASM that releases K to approved Shade agents
├── agent/                        # Part 2: Shade agent (TypeScript wrapper + Python sandbox), Dockerfile
│   ├── src/
│   └── sandbox/
├── packages/
│   ├── shared/                   # TS mirror of types, shard encryption, merkle, protocol hashing
│   └── verifier/                 # `blindmark verify <eval_id>` CLI
├── apps/
│   └── web/                      # Next.js frontend
├── benchmarks/
│   └── math-v1/                  # generator + public samples; private/ is gitignored
├── scripts/                      # build-wasm.sh, deploy-testnet.sh, seed-demo.sh
└── docs/
    ├── REFERENCES.md             # research, evidence, all doc links
    └── DEMO.md                   # demo script (create on day 12)
```

Ownership (4 members): Role 1 contract and integration (`contracts/`, `scripts/`), Role 2 Part 1 grader (`grader/outlayer-grader`, `crates/blindmark-types`), Role 3 frontend and verifier (`apps/web`, `packages/*`), Role 4 benchmarks and Part 2 (`benchmarks/`, `agent/`, `grader/outlayer-keyrelease`).

---

## 4. Tech stack

| Area | Choice |
|---|---|
| Contract | Rust, `near-sdk` 5.x, `cargo-near`, `near-workspaces` for integration tests |
| Part 1 grader | Rust to WASM, target `wasm32-wasip2`, OutLayer (Intel TDX). HTTP via a WASI P2 HTTP client. Crypto: `chacha20poly1305` (XChaCha20), `x25519-dalek`, `ed25519-dalek`, `hkdf`, `sha2` |
| Model inference | NEAR AI Cloud gateway `https://cloud-api.near.ai`, OpenAI-compatible, Confidential TEE tier only |
| Part 2 grader | Shade Agent Framework (`@neardefi/shade-agent-js`, `@neardefi/shade-agent-cli`) on Phala Cloud dstack; Docker; Python sandbox using OpenBench or pytest |
| Frontend | Next.js (App Router), TypeScript, NEAR Wallet Selector 10 with our own picker (`components/wallet-modal.tsx`, no `modal-ui`). Extensions: Sender, OKX, Bitget, Nightly, listed only when detected by their injected globals (the modules' `available` flag is always true for Nightly and MyNearWallet), with install links for the rest. Web wallets Intear and MyNearWallet stay registered so existing sessions restore, but the picker does not list them. Meteor's SDK needs `near-api-js` 6 and HOT's pulls in Solana and wallet selector 8, so both are left out. Bitget's module throws when its extension is absent, so it is listed only when installed, contract views over plain JSON-RPC, `@noble/ciphers`, `@noble/hashes`, `@noble/curves` (X25519 for the OutLayer keystore, section 11). Error bars are plain CSS, no chart library |
| Verifier | Node TypeScript CLI, contract views over plain JSON-RPC, `@blindmark/shared`, `@noble/hashes`. Check 5 uses `@phala/dcap-qvl` (pure JS Intel DCAP quote verification, Apache-2.0, Intel root compiled in). Check 6 will add `@noble/curves` (ed25519 only, per section 8) and optionally `jose` |
| Shard storage | FastFS (decided 2026-11-04). The owner's wallet sends one `__fastdata_fastfs` call per file to the BlindMark contract, with the Borsh-encoded file as arguments (`apps/web/lib/fastfs.ts`). The call fails on chain by design; the FastFS indexer reads the arguments and serves the file at `https://test.fastfs.io/<owner>/<blindmark contract>/blindmark/bm<id>/v<version>/<file>` (`main.fastfs.io` on mainnet), with CORS. No API key. Uploads are public and permanent. Ciphertext and public files only. Whether the grader WASM can fetch these URLs is [VERIFY] with Role 2 |
| Package manager | pnpm |
| Version pins | Rust 1.99.0 (`rust-toolchain.toml`). TypeScript 6.0, because `typescript-eslint` does not support 7 yet. ESLint 9, because the plugins in `eslint-config-next` do not support 10 yet. Remove each pin once its blocker clears |

---

## 5. Data formats

### 5.1 Benchmark item [FIXED]

Plaintext, private, never leaves the TEE.

```json
{
  "id": "math-v1-0001",
  "prompt": "A train travels 180 km in 2.5 hours. What is its average speed in km/h?",
  "choices": null,
  "answer": "72",
  "grading_type": "numeric",
  "rubric": null,
  "metadata": { "topic": "rates", "difficulty": 2 }
}
```

`grading_type` is one of: `mcq` (answer is a choice letter), `exact` (normalized string match), `numeric` (parse number, compare with tolerance from protocol), `regex` (answer is a regex the output must match), `llm_judge` (rubric scored by a judge model, should-have), `unit_test` (Part 2 only; `answer` is a test file reference inside the shard).

- **Precedence:** the item's `grading_type` wins; if null, use the protocol's `grading.default_type`. `Benchmark.grading_type` is a display label only.
- **`choices`:** null or an array of strings.
- **`numeric`:** after extraction and normalization, the whole string must parse as a number. Correct when `|output - answer| <= numeric_tolerance` (absolute). Unparseable output is incorrect.

### 5.2 Protocol [FIXED]

Public. Defines how items are asked and graded. Its hash is committed on-chain.

```json
{
  "version": 1,
  "system_prompt": "You are taking an exam. Reply with only the final answer.",
  "prompt_template": "{{prompt}}\n{{#choices}}Options:\n{{choices}}{{/choices}}\nAnswer:",
  "few_shot": [],
  "model_params": { "temperature": 0, "max_tokens": 256 },
  "grading": {
    "default_type": "numeric",
    "normalize": ["trim", "lowercase", "strip_trailing_period"],
    "numeric_tolerance": 1e-6,
    "answer_extraction": "last_line"
  },
  "metric": "accuracy",
  "rules": { "attempts_per_item": 1, "tools": false }
}
```

`protocol_hash = sha256(JCS(protocol))`, where JCS is RFC 8785 JSON Canonicalization. Both Rust and TS must produce identical bytes; add a cross-language test vector in `crates/blindmark-types/tests/vectors.json`. The vector must include `numeric_tolerance: 1e-6`: JCS requires `0.000001`, while `serde_json`'s default float output differs, so Rust needs a real JCS implementation.

`prompt_template` is not full Mustache. Replace `{{prompt}}`. If `choices` is null, delete the `{{#choices}}...{{/choices}}` block; otherwise keep its contents and replace `{{choices}}` with one `A. <text>` line per choice.

### 5.3 Shards and envelope encryption [FIXED]

- Owner generates a random 32-byte key **K** per benchmark version.
- Items are grouped into shards. Default 50 items per shard; plaintext must be at most **200 KiB** (OutLayer encryption calls cap at 256 KiB [VERIFY]).
- Shard plaintext: `{"benchmark_id": <u64>, "version": <u32>, "shard_index": <u32>, "items": [Item, ...]}` serialized as compact JSON (UTF-8).
- Ciphertext wire format: `0x01 || nonce(24) || XChaCha20-Poly1305(K, nonce, plaintext, aad)`.
- `aad = "blindmark:v1:" + benchmark_id + ":" + version + ":" + shard_index` (ASCII, decimal numbers).
- Shard ciphertext is uploaded publicly. Only K is a secret.

### 5.4 Merkle commitment [FIXED]

RFC 6962 style, SHA-256, domain separated:
- `leaf_i = sha256(0x00 || ciphertext_i)`
- `node = sha256(0x01 || left || right)`
- Odd node at any level is promoted unchanged to the next level (no duplication).
- `dataset_root` = root over leaves in `shard_index` order.
- Proof format: list of `{ "hash": hex, "side": "L" | "R" }` from leaf to root.

### 5.5 Statistics [FIXED]

Score is accuracy `k / n`. 95% confidence interval uses the **Wilson score interval**, z = 1.96:
- `p = k/n`, `d = 1 + z²/n`
- `center = (p + z²/(2n)) / d`
- `half = z * sqrt(p(1-p)/n + z²/(4n²)) / d`
- `low = center - half`, `high = center + half`.
- Store as basis points (u32, 0 to 10000): `score_bps`, `ci_low_bps`, `ci_high_bps`. Convert with `floor(x * 10000 + 0.5)` in f64, clamped to 0..=10000, so Rust and TS agree.
- Test vector: `k = 361, n = 500` gives `7220, 6812, 7595`.
- Leaderboard labels two models "statistically tied" when their intervals overlap.

---

## 6. Grader interface (contract to grader) [FIXED]

The contract only ever sees these shapes. Both backends (OutLayer, Shade) implement them.

```json
// GradeRequest: input to one shard run
{
  "mode": "grade",
  "eval_id": 42,
  "benchmark_id": 7,
  "version": 1,
  "shard_index": 3,
  "shard_uri": "https://.../bm7/v1/shard-0003.bin",
  "shard_hash": "<hex leaf hash, i.e. sha256(0x00||ct)>",
  "merkle_proof": [{ "hash": "<hex>", "side": "L" }],
  "dataset_root": "<hex>",
  "protocol_uri": "https://.../bm7/v1/protocol.json",
  "protocol_hash": "<hex>",
  "model_id": "<canonical NEAR AI model id>",
  "nonce": "<hex 32 bytes, contract-generated from env::random_seed>"
}
```

```json
// GradeResult: output of one shard run, MUST be <= 900 bytes serialized
{
  "eval_id": 42,
  "shard_index": 3,
  "shard_hash": "<hex>",
  "sealed_partial": "<base64url>",
  "evidence_hash": "<hex sha256 of evidence bundle>",
  "backend": "outlayer-v1",
  "ok": true,
  "error": null
}
```

```json
// AggregateRequest: input to the final run
{
  "mode": "aggregate",
  "eval_id": 42,
  "expected_shards": 10,
  "sealed_partials": [{ "shard_index": 0, "sealed": "<base64url>" }],
  "n_items_expected": 500,
  "nonce": "<hex>"
}
```

```json
// AggregateResult: MUST be <= 900 bytes
{
  "eval_id": 42,
  "n_items": 500,
  "n_correct": 361,
  "score_bps": 7220,
  "ci_low_bps": 6812,
  "ci_high_bps": 7595,
  "mean_latency_ms": 1840,
  "ok": true,
  "error": null
}
```

**Failure semantics.** `error` is a fixed code (`shard_fetch`, `hash_mismatch`, `decrypt`, `protocol`, `model_call`, `seal`, `upload`), never free text, so it cannot carry item content or model output. Transport errors on a model call get a short bounded retry. A received answer is final (`attempts_per_item`). An item with no answer fails the whole shard with `ok: false`; it never counts as incorrect, because an outage must not lower a model's score.

**Sealed partial.** Plaintext `{"eval_id","shard_index","n","correct","latency_ms_sum"}` sealed with the OutLayer encryption key at path `partials`, `aad = "blindmark:partial:" + eval_id + ":" + shard_index`. Only a later run of the same grader project with the same caller (the BlindMark contract, `caller: "predecessor"`) can open it [VERIFY]. Per-shard scores are therefore hidden; only the aggregate is published.

**Evidence bundle.** JSON stored off-chain, hash returned in `evidence_hash`:
```json
{
  "eval_id": 42, "shard_index": 3, "model_id": "...",
  "nearai_gateway_report": { "...": "raw attestation JSON" },
  "nearai_model_report": { "...": "raw attestation JSON" },
  "nonce": "<hex>",
  "calls": [
    { "request_sha256": "<hex>", "response_sha256": "<hex>",
      "signature_kind": "provider_tee", "signing_algo": "ed25519",
      "signing_address": "<hex>", "signature": "<hex>", "text": "<signed text>" }
  ]
}
```
Contains hashes and signatures only, never plaintext. Confirm that the signed `text` holds only hashes; if it holds anything else, leave it out and have the verifier rebuild it [VERIFY]. Upload target from inside WASM is **[VERIFY]** (spike S5). Fallback: return a compact digest and document the gap.

---

## 7. NEAR contract spec (`contracts/blindmark`)

### 7.1 State [FIXED unless marked]

```
admin: AccountId
outlayer_contract: AccountId              // outlayer.testnet or outlayer.near
platform_fee_bps: u16                     // default 500 (5%)
treasury: AccountId
next_benchmark_id: u64
next_eval_id: u64
backends: IterableMap<String, Backend>
models: IterableMap<String, ModelInfo>    // allowlist of canonical model ids
benchmarks: IterableMap<u64, Benchmark>
evals: LookupMap<u64, Eval>
certificates: LookupMap<u64, Certificate>
cert_index: LookupMap<u64, Vector<u64>>   // benchmark_id -> eval_ids certified
usage: LookupMap<(u64, String), Usage>    // (benchmark_id, model_id) -> probing limits
```

```
Backend { id, kind: OutLayer | ShadeDstack, measurement: String /* wasm sha256 or image digest */,
          outlayer_project: Option<String>, active: bool }
ModelInfo { id, tier: "A" | "B" | "C", active: bool }
Benchmark { id, version, owner: AccountId, title, description, grading_type,
            dataset_root: String, protocol_hash: String, protocol_uri: String,
            shard_uris: Vec<String>, shard_hashes: Vec<String>, item_count: u32,
            sample_items_uri: Option<String>, price: U128,
            secret_ref: SecretRef { owner: AccountId, profile: String },
            max_evals_per_model: u32 /*default 3*/, cooldown_ns: u64 /*default 24h*/,
            status: Active | Retired, created_at_ns, created_block }
Eval { id, benchmark_id, requester, model_id, backend_id, fee: U128, compute_budget: U128, compute_spent: U128,
       status: Dispatching | Grading | Aggregating | Certified | Failed | Refunded,
       next_shard_to_dispatch: u32, retries_left: u32, retry_shards: Vec<u32>,
       partials: Vec<Option<SealedPartial>>,
       evidence_hashes: Vec<Option<String>>, nonce: String,
       created_at_ns, created_block, deadline_ns }
Certificate { eval_id, benchmark_id, benchmark_version, dataset_root, protocol_hash,
              model_id, trust_tier, backend_id, grader_measurement,
              n_items, n_correct, score_bps, ci_low_bps, ci_high_bps, mean_latency_ms,
              evidence_hashes: Vec<String>, issued_at_ns, issued_block }
Usage { count: u32, last_requested_ns: u64 }
```

### 7.2 Methods

Admin:
- `new(admin, outlayer_contract, treasury, platform_fee_bps)`
- `add_backend(backend)`, `set_backend_active(id, active)`
- `add_model(model)`, `set_model_active(id, active)`

Owner:
- `register_benchmark(args) -> u64` (payable, covers storage). Validates: `shard_uris.len() == shard_hashes.len()`, 1 to 64 shards, recomputes `dataset_root` from `shard_hashes` and rejects mismatch, price > 0, item_count > 0.
- `retire_benchmark(id)` (owner only; existing evals still complete).

Model team:
- `request_eval(benchmark_id, model_id, backend_id) -> u64` (payable). Requires attached deposit `>= price + compute_budget(shard_count) + eval_storage_deposit(shard_count)`, and refunds any excess at once. `compute_budget(shard_count) = (shard_count + 1 + MAX_RETRIES) * COMPUTE_PER_RUN`, covering every shard, aggregation and the retries, with `MAX_RETRIES = 3` per eval and `COMPUTE_PER_RUN` a constant 0.02 NEAR (section 7.3). `eval_storage_deposit(shard_count)` is a non-refundable base amount plus a per-shard amount covering the eval and certificate records; a storage test checks it always covers the storage used. Checks: benchmark active, model active, backend active and of kind `OutLayer` (`ShadeDstack` is rejected until Part 2), probing limits (count and cooldown). `Usage.count` goes up here and down on `Refunded`, since a refunded eval published no score; the cooldown is not reset. Creates `Eval`, sets `deadline_ns = now + 6h`, dispatches up to `MAX_DISPATCH_PER_TX = 3` shards (measured in S6, section 7.3; integration tests must confirm it with the real contract's overhead).
- `continue_dispatch(eval_id)` (anyone can call, requires `now <= deadline_ns`): sends runs up to `MAX_DISPATCH_PER_TX`, queued retries first, then the next unsent shards. Status moves from `Dispatching` to `Grading` once every shard has been sent. With status `Grading`, no queued retries and every partial present, it sets `Aggregating` and dispatches the aggregate run. Otherwise it panics, because there is nothing to send.

Callbacks (`#[private]`). Each is a no-op if the eval is no longer in the status it expects, because a result can arrive after a refund. A rejection sets status `Failed` and returns normally; a panic would discard that state change.
- `on_shard_graded(eval_id, shard_index)`: expects `Dispatching` or `Grading` and an empty slot for that shard. Parses OutLayer output into `GradeResult`; rejects if `eval_id`, `shard_index` or `shard_hash` mismatch or `ok == false`; stores `sealed_partial` and `evidence_hash`. A `null` result is a lost or crashed run, not a rejection: if `retries_left > 0`, decrement it and queue the shard in `retry_shards`; otherwise set `Failed`. A failed promise means misconfiguration or too little gas, so it sets `Failed`. Aggregation is started by `continue_dispatch`, not here.
- `on_aggregated(eval_id)`: expects `Aggregating`. On a `null` result with `retries_left > 0`, decrement it and return to `Grading` so `continue_dispatch` resends aggregation; with none left, set `Failed`. Otherwise parses `AggregateResult`; rejects unless `eval_id` matches, `ok == true` and `n_items == benchmark.item_count`; writes `Certificate`; pays treasury `price * platform_fee_bps / 10000` (integer floor) and the owner the remainder; refunds unused compute budget; status `Certified`; emits event.

Anyone:
- `refund_expired(eval_id)`: if status is `Failed`, or `now > deadline_ns` and status is neither `Certified` nor `Refunded`, set status `Refunded` first, then refund the requester (`price + compute_budget - compute_spent`).

Views: `get_benchmark`, `list_benchmarks(from, limit)`, `get_eval`, `get_certificate(eval_id)`, `list_certificates(benchmark_id, from, limit)`, `get_backends`, `get_models`, `get_usage(benchmark_id, model_id)`, `eval_storage_deposit(shard_count)`. Nanosecond fields (`*_ns`) are `U64` in JSON, a decimal string, because they exceed what a JavaScript number holds exactly.

Storage deposit: 1,500 bytes plus 750 per shard at the storage byte price. Unit tests measured 987 bytes for 1 shard and 43,656 for 64 with the largest allowed results, and fail if the deposit ever falls below the measured use.

Part 2 (after day 8):
- `register_agent(attestation)`: verifies TDX attestation with the `shade-attestation` crate against the `ShadeDstack` backend measurement; stores agent account and public key.
- `is_agent_approved(account_id) -> Option<AgentInfo>` (view, read by `outlayer-keyrelease`).
- `submit_shard_result(eval_id, shard_index, result: GradeResult)`: callable only by a registered agent for evals using a `ShadeDstack` backend.

### 7.3 OutLayer call from the contract

Cross-contract call to `outlayer_contract.request_execution` with attached deposit from the eval's compute budget, then `.then(on_shard_graded)`. Tested live on testnet in S6 (results in section 15), except `secrets_ref`, which S4 tests:

```
request_execution({
  "source": { "Project": { "project_id": "<owner>/<project>", "version_key": "<backend.measurement>" } },
  "resource_limits": { "max_instructions": 500000000000, "max_memory_mb": 256, "max_execution_seconds": 180 },
  "input_data": "<GradeRequest JSON string>",
  "secrets_ref": { "profile": "<benchmark.secret_ref.profile>", "account_id": "<benchmark.secret_ref.owner>" },
  "response_format": "Json",
  "payer_account_id": "<eval.requester>"
})
```

- **`resource_limits` is required.** Without it OutLayer only compiles and never runs the code. S3 may lower these values.
- **`secrets_ref`** is sent for grade runs only. Aggregate runs do not need K.
- **Callback result.** With `response_format: "Json"`, the promise succeeds with the grader's stdout as JSON. OutLayer reparses that JSON and may reorder keys, so nothing may depend on its exact bytes. The promise also succeeds, with `null`, when the guest exits non-zero, prints non-JSON or the run is lost. It fails only if `request_execution` itself panics or runs out of gas. Read it with `env::promise_result_checked`, parse it by hand and treat malformed JSON or more than 900 bytes as a rejection. Never use `#[callback_result]`, because a parse failure there panics and loses the `Failed` status.
- **Lost runs.** 1 of 17 live runs got no result and returned `null` after about 120 s, charged only the base fee. That is one sample, but an 11-run eval would fail about half the time at that rate, so `null` is retried up to `MAX_RETRIES` (section 7.2).
- **Deposit.** `COMPUTE_PER_RUN` is 0.02 NEAR; `estimate_execution_cost` on testnet returned 0.01905 NEAR for the limits above, and a small live run cost about 0.001 NEAR. A price change means redeploying. Input up to 32 KB holds no extra deposit.
- **Refunds.** OutLayer sends unused compute straight to `payer_account_id`, so the contract counts all it attaches as `compute_spent`. If `request_execution` itself panics or runs out of gas, that run's deposit returns to the contract and stays there (seen live). This is accepted so the contract can never refund money it does not hold.
- **Gas.** Attach 60 Tgas to `request_execution` (60 worked with a 20 KB input; 52 ran out) and at least 10 Tgas to each callback. 3 dispatches per transaction used 218 of 300 Tgas, a 27% margin; 4 used 291, a 3% margin. A callback that also starts aggregation uses about 153 Tgas per shard, and 2 of those exceeded the 300 Tgas limit, so aggregation is started by `continue_dispatch`. In the sandbox with the real contract, `request_eval` with 3 dispatches burnt 5.5 Tgas in BlindMark's own receipt, on top of the 210 Tgas it attaches to runs and callbacks.
- **Callers must not wait for final execution.** A `request_eval` or `continue_dispatch` transaction stays unfinished until OutLayer's worker answers, because OutLayer pauses it with yield/resume. A client waiting for final execution hits its RPC timeout, and some clients, including `near-workspaces`, then re-sign and send the call again, which requests a second eval. Send these calls with `waitUntil: "INCLUDED"` or async, never retry them automatically, and follow progress through `get_eval`.

**Version pinning is a score integrity requirement [FIXED requirement, verified live in S6].** Every dispatch, grade and aggregate, must set `version_key` to the backend's `measurement`. Omitting it runs the project's active version, which the project owner can change: live, a pinned call ran `v1` while an unpinned call ran the newly activated `v2`. The `WasmHash` condition on K protects only confidentiality: another project version cannot read K, but it could still print a forged `GradeResult` or `AggregateResult`, and the contract would certify it.

A version key equals the WASM hash only for a `WasmUrl` version; a GitHub-sourced version's key is `repo@commit`. So the grader must be published as a `WasmUrl` version. `WasmUrl` accepts only `https://` URLs, and OutLayer checks the hash. We host grader builds as GitHub Release assets on this repo.

### 7.4 Events [FIXED]

NEP-297, `standard: "blindmark"`, `version: "1.0.0"`. Events: `benchmark_registered`, `eval_requested`, `shard_graded`, `eval_certified`, `eval_refunded`, `agent_registered`. `data` is a single object, not an array, for example `{"eval_id":0,"amount":"1100000000000000000000000"}`.

### 7.5 Contract invariants

- The price leaves escrow only on `Certified` (owner + treasury) or `Refunded` (requester), exactly once. The compute budget is spent on OutLayer as runs are dispatched (tracked in `compute_spent`); the contract returns only the part never dispatched, and OutLayer refunds each run's unused compute to the requester directly.
- `Certified` and `Refunded` are terminal.
- A certificate is issued only when every shard of the eval has a valid `GradeResult`.
- Benchmark commitments (`dataset_root`, `protocol_hash`, `shard_hashes`) are immutable; changes require a new version.
- Callbacks are `#[private]` and handle promise failure by marking the eval `Failed` (refund via `refund_expired`).
- Owner before production: remove full-access keys or make the admin a multisig (Trezu).

---

## 8. Part 1 grader spec (`grader/outlayer-grader`)

Single WASM binary, reads JSON from stdin, writes JSON to stdout, flushes. Build: `cargo build --target wasm32-wasip2 --release`. Use `[[bin]]`, not `[lib]` [FIXED per OutLayer docs].

**Secrets and keys.**
- K arrives as an env var from the OutLayer secret referenced by `secrets_ref`. Env var name: `BLINDMARK_K` (hex) [FIXED name, VERIFY delivery]. **If `BLINDMARK_K` is missing, fail closed.** OutLayer runs the WASM without secrets when the referenced secret does not exist (seen in its worker source), so a missing K must produce `ok: false`, never a graded result.
- `NEARAI_API_KEY` arrives as an author secret declared in the manifest (`author_secrets`) [VERIFY].
- Encryption key path `partials` declared in the manifest with `bind: "project"`, `caller: "predecessor"`, and `storage_account: "predecessor"` [VERIFY].

**Secret access condition (owner sets it on the K secret).** `{"Logic":{"operator":"And","conditions":[{"WasmHash":{"hash":"<approved grader sha256>"}},{"Predecessor":{"condition":{"Whitelist":{"accounts":["<blindmark contract>"]}}}}]}}` so only the approved build, called through our contract, can read K. Names are from the OutLayer contract source; S4 tests them live [VERIFY]. The `Predecessor` wrapper is essential: every other condition is judged against the transaction signer, not the calling contract.

**Mode `grade` steps.**
1. Parse and validate `GradeRequest`.
2. HTTPS GET `shard_uri`; check `sha256(0x00||ct) == shard_hash`; verify `merkle_proof` against `dataset_root`. Reject on mismatch.
3. Decrypt with K and the shard AAD (section 5.3).
4. HTTPS GET `protocol_uri`; check `sha256(JCS(protocol)) == protocol_hash`.
5. NEAR AI preflight: `GET /v1/attestation/report?model=<id>&provider=near&signing_algo=ed25519&nonce=<nonce>` with `x-no-aliasing: true`. Select the verified model report and its `signing_public_key` [VERIFY how much verification fits in WASM; minimum is nonce match plus key extraction, full verification is done by the verifier CLI from the evidence bundle].
6. For each item: render the prompt, E2EE-encrypt each message to the model key (X25519 + HKDF-SHA256 info `ed25519_encryption` + XChaCha20-Poly1305), POST `/v1/chat/completions` with headers `X-Signing-Algo: ed25519`, `X-Client-Pub-Key`, `X-Model-Pub-Key`, `X-Encryption-Version: 2`, `x-no-aliasing: true`, `Accept-Encoding: identity`, body `stream: false`. Keep exact request and response bytes for hashing. Decrypt the response, extract the answer, grade.
7. Fetch `GET /v1/signature/<chat_id>?signing_algo=ed25519` per call; record into the evidence bundle; tolerate "unavailable" with a short bounded retry and mark the call unverified.
8. Seal the partial (section 6), upload the evidence bundle [VERIFY], emit `GradeResult`.

**Mode `aggregate` steps.** Open every sealed partial, check shard indices are `0..expected_shards` exactly once, sum, compute Wilson interval, emit `AggregateResult`.

**Stdout is public if it is not valid JSON [seen live in S6].** OutLayer writes the failure, including the guest's stdout, to a public on-chain log. So stdout must only ever be the single result JSON, and nothing derived from items, answers, K or model output may reach stdout, including through panic messages or a partly written result. Set a panic handling path that emits a fixed error code. Failure logs also include guest backtraces, so assume stderr and panic text may become public too until S3 shows otherwise.

**Limits [VERIFY].** Execution time 60 s default, 180 s max; output at most 900 bytes (our own bound, enforced by the contract; OutLayer allows far more); plan for a real limit near 120 s, because a run with no result came back as `null` after about 120 s in S6, and S3 must confirm whether longer runs survive; no file system; memory in-process only. Keep shards small enough to finish within the limit (measure in spike S3). The default 50 items will not fit the default limit if run sequentially: at the section 6 example latency that is 92 s before signature fetches. S3 decides the shard size, time limit and any concurrency; record them here.

**Reproducible build [FIXED].** Commit `Cargo.lock`. Use OutLayer's `scripts/build_github_wasm.sh --target wasm32-wasip2` so the sha256 is known before publishing. The sha256 is the backend `measurement`, the project's `version_key` and the secret's `WasmHash` condition. Publish each build as a `WasmUrl` project version (section 7.3).

**Tamper test (demo).** Change one line (for example, print an item), rebuild, deploy as a new version, run: K must not decrypt (different hash). Also show that the tampered version cannot produce a certificate through the contract (section 7.3). Record both.

---

## 9. NEAR AI Cloud rules [FIXED, from docs]

- Use only models labelled **Confidential TEE** in the catalog (`GET https://cloud-api.near.ai/v1/models`). Never use Incognito models (OpenAI, Anthropic, Gemini) for tier A; they run outside a TEE.
- Only a `provider_tee` signature binds a response to the model TEE. To get one: non-streaming, canonical model id, `x-no-aliasing: true`, hash exact request and response bytes, `Accept-Encoding: identity`.
- Streaming, alias resolution and the Responses API produce `gateway` signatures (gateway-bound only). Do not use them.
- Signatures are sometimes unavailable; treat missing as unverified, never as verified.
- The docs state the model to gateway to final response chain is not fully closed. Say so in the README limitations.
- Default concurrency is 64 requests per model per organization.

---

## 10. Verifier CLI spec (`packages/verifier`)

`pnpm blindmark verify <eval_id> [--network testnet] [--contract <account>] [--json]`

Checks, each printed as PASS, FAIL or WARN, exit code non-zero on any FAIL:
1. **Certificate exists** and eval status is `Certified`.
2. **Commitments**: certificate `dataset_root` and `protocol_hash` equal the benchmark's, and the benchmark was registered at a block before the eval.
3. **Merkle**: recompute `dataset_root` from on-chain `shard_hashes`; optionally fetch ciphertexts and re-hash.
4. **Grader build**: certificate `grader_measurement` equals the measurement of its `backend_id` (WARN, not FAIL, if that backend is now inactive, since older certificates stay valid); OutLayer execution attestations report that code hash. How (verified live on eval 0, 2026-11-04): list the grader project's jobs during the eval (`GET <api>/public/jobs?project=<outlayer_project>`), read each job's transaction from an archival RPC (input from the `execution_requested` event, output from OutLayer's return value), fetch `GET <api>/attestations/<job_id>`, and keep only payloads whose sha256 equals the record's `input_hash` (exact string) and `output_hash` (compact JSON, keys sorted). For every shard the run whose output equals the stored `sealed_partial` and `evidence_hash`, and for aggregation the run whose output equals the certified counts, must report `wasm_hash` equal to `grader_measurement` and carry the eval's nonce. A different code hash, or an attested aggregate run with other counts, is FAIL; a run with no attestation is WARN. `GET /attestations/by-tx/<hash>` returns only one record per transaction, so it is not used. API base: `https://testnet-api.outlayer.ai` (the `outlayer.fastnear.com` hosts are retired).
5. **Intel attestation**: verify the OutLayer TDX evidence (and optionally NEAR AI Intel Trust Authority JWT with `jose`). For each run check 4 accepted: the quote's signature chain verifies to Intel's root with the collateral OutLayer archived for the run's time (`GET <api>/public/collateral?fmspc=&at=`); the first 32 bytes of `report_data` equal the task hash recomputed from the record (field order from `out-layer/outlayer-verify`); and `is_measurements_approved` on `worker.outlayer.testnet` returns true for the quote's MRTD and RTMR0 to RTMR3. Revoked TCB or any mismatch is FAIL; a TCB status other than `UpToDate`, or collateral or approval that cannot be fetched, is WARN.
6. **Model evidence**: fetch each evidence bundle, check its sha256, verify the NEAR AI model report and that each `provider_tee` signature verifies against the report's signing key; report the share of calls verified. A hash mismatch or bad signature is FAIL. A missing signature, or a missing bundle under the S5 fallback, is WARN and never counts as verified.
7. **Statistics**: recompute the Wilson interval from `n_correct` and `n_items`.

Output must be readable by an AI judge from a terminal in under a minute.

---

## 11. Frontend spec (`apps/web`)

| Route | Purpose |
|---|---|
| `/` | Benchmark explorer: short intro and trust chain, overview cards (score distribution, leader per benchmark, latest certificates), benchmarks table filterable by status and search, then how it works and how to verify |
| `/leaderboard` | Full leaderboard explorer: every latest certificate in one table, filter by benchmark, trust tier and search, sort by score, n or issue time; change from the previous attempt |
| `/benchmarks/new` | Owner wizard: upload JSONL and protocol, encrypt shards in the browser, compute Merkle root, upload ciphertext, register on-chain, then create the locked K secret in OutLayer: `POST <api>/secrets/pubkey` with the variable name and an empty value (the keystore checks names only) returns the keystore key; K is encrypted in the browser with the keystore's ECIES (X25519, HKDF-SHA256 info `outlayer-keystore-v1`, ChaCha20-Poly1305) and stored with `store_secrets` on the OutLayer contract (accessor `Project`, one profile per benchmark version, the section 8 condition, deposit from `estimate_storage_cost`); `get_secrets` must then hold that exact ciphertext. Not yet run with a real wallet [VERIFY]. The keystore key is served by an unauthenticated coordinator route and is not attested here, so it is part of the OutLayer keystore trust assumption (section 18) |
| `/benchmarks/[id]` | Benchmark card: protocol, sample items, item count, price, certificates; "Request evaluation" button |
| `/evals/[id]` | Live status: shards graded, aggregation, certificate link |
| `/certificates/[id]` | Certificate details, trust tier, verify command to copy, data path trace with a proof badge per hop |

Rules: K and plaintext never leave the browser except encrypted to the OutLayer keystore key. Never put K in URLs, logs, analytics or local storage. Send `request_eval` and `continue_dispatch` without waiting for final execution and never retry them automatically (section 7.3); poll `get_eval` for progress.

Leaderboard: show each model's latest certificate per benchmark and its number of attempts, never its best, because best-of-N inflates scores.

---

## 12. Part 2: Shade agent for code benchmarks (after day 8 checkpoint)

- `agent/` Docker image pinned by `@sha256:` digest. TypeScript wrapper uses `shade-agent-js` to register with attestation (`register_agent` on our contract).
- Agent generates an ephemeral X25519 key, requests K from the `outlayer-keyrelease` project. That WASM calls `view(<blindmark contract>, "is_agent_approved", {account_id})`, then encrypts K to the agent key and returns it (fits in 900 bytes).
- Agent decrypts K in memory only, grades code shards: model writes code via NEAR AI Cloud, Python sandbox runs hidden unit tests (OpenBench or pytest in a locked-down subprocess, no network).
- Agent calls `submit_shard_result`. Part 2 partials may be plain (documented limitation) unless sealing is solved.
- **K access differs from Part 1.** The section 8 condition allows only the grader hash called through our contract. `outlayer-keyrelease` has a different hash and the agent is its caller, so it needs its own secret or profile with its own condition [VERIFY in S8].
- **Aggregation [TBD, simplest pick].** Section 7.2 has no `AggregateResult` path for Shade. Pick: when the last `submit_shard_result` arrives, the contract sums the plain partials and computes the Wilson interval with `blindmark-types`. Per-shard scores are public for Part 2 (documented limitation).
- Security from Shade docs: never write K or items to disk (disk survives upgrades and the host can read app keys), disable public logs, use `sanitize`/`addSensitive`, remove local mode before demo, include a nonce in every request.

---

## 13. Trust tiers [FIXED]

Every certificate shows its tier.

| Tier | Meaning | Status |
|---|---|---|
| A | Open model in NEAR AI Confidential TEE, grader in TEE: prompts hidden from everyone | Build |
| B | Lab runs its closed model in its own attested confidential VM and GPU, registers the endpoint | README roadmap (basic version only if ahead) |
| C | Closed model via normal API with per-provider canaries; leaks detectable, not prevented | Cheap addition if time |

---

## 14. Scope and milestones

**Must-have**
1. Contract: benchmarks, evals with escrow, backends, models allowlist, certificates, payout, refund, probing limits. **Done when** `near-workspaces` tests pass for payout, refund, second refund rejected, late callback after refund ignored, lost-run retries, and probing limits.
2. Part 1 grader: grade and aggregate modes, E2EE model calls, MCQ/exact/numeric grading, sealed partials. **Done when** a testnet eval through the contract against real NEAR AI produces a certificate, built without the `mock` feature.
3. Owner upload flow with browser encryption and Merkle root. **Done when** `register_benchmark` accepts the browser-computed root and the grader decrypts the browser-encrypted shards.
4. Verifier CLI. **Done when** it passes on a real certificate and exits non-zero on a fixture with an altered score.
5. One real benchmark: `math-v1`, 300 to 500 perturbed items (check source licence). **Done when** the item count is in range, the licence is recorded and `git ls-files 'benchmarks/*/private/*'` prints nothing.
6. Tamper test recorded. **Done when** the recording shows both section 8 assertions.
7. README with "do X, see Y" steps and limitations. **Done when** someone following "Try it" from a clean checkout reaches a verified certificate.

**Cheap additions**: ~5 public sample items per benchmark, trust tier label, cost and latency on certificates, attested benchmark card (item count, reference model baselines).

**Should-have (if ahead by day 9)**: leaderboard polish, `llm_judge` grading, self-settling bounty, contamination gap demo (public original vs hidden perturbed).

**Part 2 (after day 8)**: Shade grader, key release, coding benchmark, Part 2 tamper test.

**Out of scope**: Tier C question generator, Agent Market integration, USDC or Intents payments, real benchmarks beyond `math-v1` and the Part 2 coding benchmark, dataset rotation, DAO governance, token.

**Timeline**
| Days | Milestone |
|---|---|
| 1 | Agree interfaces in this file (sections 5, 6, 7). Each role runs its spike |
| 2 | Contract core; grader reads shard and decrypts; browser encryption |
| 3 to 5 | Grader end to end on one shard against NEAR AI; contract escrow and callbacks |
| 6 to 7 | Sharding, sealed partials, aggregation; verifier CLI; upload UI; benchmark ready; tamper test |
| 8 | Checkpoint: Part 1 end to end on testnet. If not, cut Part 2 to docs only |
| 9 to 11 | Part 2; leaderboard; hardening |
| 12 to 13 | README, demo video, X post (human posts) |
| 14 | Buffer; human submits |

---

## 15. Spikes to run first [VERIFY]

| ID | Question | Pass condition |
|---|---|---|
| S1 | Which NEAR AI models are Confidential TEE today; latency for 50 calls | List recorded in this file; p50 and p95 measured |
| S2 | Do non-streaming, `x-no-aliasing` requests return `provider_tee` signatures | At least 90% of calls signed |
| S3 | OutLayer WASM: HTTPS fetch of a 200 KiB shard, decrypt, 50 model calls | Completes within the real time limit; limit recorded |
| S4 | OutLayer secret with WasmHash + Predecessor condition readable only via our contract | Direct call refused; contract call succeeds; changed build refused |
| S5 | Can the grader upload the evidence bundle from WASM | Upload works, or fallback chosen and recorded |
| S6 | `request_execution` call shape, callback result format, gas and deposit | Contract integration test passes on testnet; a newer project version is not executed when the call is pinned (section 7.3) |
| S7 | Encryption key `partials` with `caller: predecessor` opens across runs | Seal in run A, open in run B via contract |
| S8 | Phala deploy of Shade template; gas for on-chain attestation verify | Registered agent; gas recorded |

Record results in this section as they land.

**S6 result (2026-11-03): passed live on testnet, using a throwaway contract and guest.** The remaining S6 condition, the integration test with the real BlindMark contract, belongs to the contract work. Findings are in sections 7.2, 7.3 and 8. Spike contract: `spike.blindmark-jh-fe87ee.testnet`, project `blindmark-jh-fe87ee.testnet/s6`, builds on the `spike-s6` pre-release (delete after S4 and S7). The Rust 1.99 contract built with `cargo near` deployed and ran on testnet.

| Test | Result | Transaction |
|---|---|---|
| Pinned to `v1`, `v2` active | Ran `v1` | `C8DJMvFKYEB9qjxP13LnW3tyiTNFGMBrPw1AuwQQTvV4` |
| Unpinned | Ran `v2` | `9nhshPUMyTsofUrzXjSHivKiUqfhRJP4HPiD9tpSDh7S` |
| Guest exits non-zero | Success with `null` | `J1yxrVvNg2mDjjECn4UzXmUvqEyYqama2TrRRAf84zuE` |
| Guest prints non-JSON | Success with `null`; stdout in public log | `5UYMLYVCXmFZcMLpRF7fhaVdaAf2tSDZYb8KNbEvwpyp` |
| Unknown version key | Promise failed; deposit back to contract | `3FNxJz2NBPSmvTe8CL8KobFUX46D1GYb4stTFGh4PpYK` |
| Request gas 52 Tgas | Out of gas; promise failed | `DxAjqfKkfcHWGd32k64VjaabEgqCVhm2QEv4SKLb9Xsq` |
| 3 dispatches at 60 + 10 Tgas | 218 Tgas; 1 run lost after about 120 s | `HbkfRumdH79nqykyFxGpnZYH1Kqu74qqcGbjgaJ84zn5` |
| 4 dispatches at 60 + 10 Tgas | 291 Tgas; all ran | `9kSKXYkudz5RqyAJx5TerhUMWBfUF5nh2rkTpCy3abLx` |
| 20 KB input at 60 Tgas | Ran | `Bcn8UKvuTWBWPuLaj5VdkpGH9424tbHYMhfv6PnS6q6R` |
| Callback dispatches a follow-up | Ran; 153 Tgas per shard | `ySoEX7TdcDt6LxWMGRE38ABbr4L5y6nWrvUDwAfpCHB` |
| 2 dispatches with follow-ups | Out of gas; transaction failed | `8BJGpFbX7m5XxApBPNXqPh6MtYVbU8fCKPw6frQrWMqG` |

Role 2 runs S4 and S7 on the spike contract, which accepts any project and can pass `secrets_ref`.

**S6 integration (2026-11-03): passed in a local sandbox** running the real BlindMark contract against OutLayer's deployed contract code, with the test as the worker (`contracts/blindmark/tests/sandbox.rs`). A full eval certified and paid out, a lost run was retried, and an unknown pinned version failed and refunded.

**Testnet end to end (2026-11-03): passed.** `scripts/e2e-testnet-stub.mjs` certified eval 0 on `blindmark.blindmark-jh-fe87ee.testnet` through OutLayer's real worker in about 2.5 minutes, using the test-only stub grader (`scripts/stub-grader`, backend `test-stub-94149ba5`, score 0 by design). One grade run was lost and returned `null` after about 120 s; the contract queued it and resent it, and it then succeeded. That is 2 lost runs out of about 20 on testnet so far, so `MAX_RETRIES` matters. Final `continue_dispatch` transactions: `3tKLYJmAUmExsFEJGqGL3PUYirxVXKQ7RXbDPk1XsGa1`, `3LCig4kwGkWwqEnbNW9FN8RwLFSRA9VGwRA5cCVBkdHP`.

---

## 16. Commands

```bash
# Rust
cargo test -p blindmark-types
cargo check -p blindmark-contract --target wasm32-unknown-unknown      # near-sdk 5.30 refuses plain host `cargo check`
cargo install cargo-near --locked                                      # once per machine
cargo near build non-reproducible-wasm --manifest-path contracts/blindmark/Cargo.toml   # output in target/near/; `reproducible-wasm` untested [VERIFY]
cargo test -p blindmark-contract                                       # includes sandbox tests: needs network on first run, about 1 minute
cargo build -p outlayer-grader --target wasm32-wasip2 --release

# JS
pnpm install
pnpm --filter @blindmark/web dev
pnpm --filter @blindmark/verifier build && pnpm blindmark verify <eval_id>

# Deploy (testnet only without asking). Needs .env and `cargo near`; scripts refuse other networks.
./scripts/deploy-testnet.sh                                            # creates, deploys only changed code, initializes once
node scripts/e2e-testnet-stub.mjs <stub wasm> <https URL>              # TEST ONLY: throwaway eval with scripts/stub-grader
```

---

## 17. Coding conventions

- Rust: `cargo fmt`, `cargo clippy -- -D warnings`. No `unwrap()` in contract or grader paths; return typed errors. Keep `blindmark-types` free of NEAR and WASI dependencies so both contract and grader use it.
- TS: strict mode, ESLint, Prettier. Types in `packages/shared` mirror `blindmark-types` exactly; add JSON test vectors shared by both.
- Tests: unit tests for merkle, envelope crypto, JCS, Wilson interval, grading normalizers; `near-workspaces` integration tests for escrow, callbacks, refunds and probing limits, run against OutLayer's real Apache-2.0 contract in a local sandbox with the test playing the worker. It is fetched at test time and not committed. A mock OutLayer behind the `mock` feature is the fallback only if that setup fails. Before Role 2's grader is ready, testnet evals use a clearly named test-only stub WASM and backend, never in the demo path.
- Every public function touching secrets gets a comment stating what it must never log or return.

---

## 18. README requirements (judges, including AI judges)

Sections in order: What it is (2 sentences) → Problem (with 3 evidence links) → Why NEAR AI's TEE alone is not enough → How it works (diagram) → Try it ("do X, see Y" steps on testnet) → Verify a certificate (one command) → Tracks and NEAR tech used (NEAR AI Cloud, OutLayer, NEAR contract, Shade Agents) → Trust tiers → Limitations → Prior art (Attestable Audits, TRUCE) → Team. No marketing language.

Limitations to state: tier A only for Confidential TEE models; trust in Intel TDX and NVIDIA (TEE.fail); NEAR AI signature chain not fully closed; repeated queries could partly reconstruct a test set (fees, caps and cooldowns reduce it); OutLayer keystore and DAO are trust assumptions; the owner holds K and could leak items to a favoured model team, so a certificate proves the grading, not the owner's honesty; anyone willing to pay can use up a model's eval cap on a benchmark.