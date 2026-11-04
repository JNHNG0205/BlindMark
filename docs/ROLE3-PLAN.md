# Role 3 plan: frontend and verifier

Brief for any agent or person picking up Role 3 work on BlindMark. Written on day 4 of 14 (2026-11-04), on branch `ui` at commit `8ebd18a`. This file is a working note: it is not committed and must not be committed unless the human says so.

`CLAUDE.md` (and its Codex copy `AGENTS.md`) is the source of truth. If this file and `CLAUDE.md` disagree, `CLAUDE.md` wins. Section numbers below (for example "section 5.3") refer to `CLAUDE.md`.

---

## 0. Read first

### What Role 3 owns

Role 3 is frontend and verifier. It owns these directories only (section 3):

- `apps/web/`: Next.js App Router frontend
- `packages/shared/`: TS mirror of the Rust types, shard encryption, Merkle, JCS, Wilson stats
- `packages/verifier/`: the `blindmark verify <eval_id>` CLI

Do not edit `contracts/`, `scripts/` (Role 1), `grader/`, `crates/` (Role 2) or `benchmarks/`, `agent/` (Role 4). If something there blocks you, write it down and tell the human. Exception: when an interface in sections 5 to 7 changes, update `CLAUDE.md`, `AGENTS.md`, the Rust types and the TS mirror in the same change (coordinate with Role 2 for the Rust side).

From the team role sheet, Role 3's job is:
- Owner upload: browser encryption, Merkle root, shard upload (FastFS or IPFS)
- Eval request page, certificate view
- Leaderboard with error bars
- One-command verifier CLI
- Days 12 to 13: demo video and X post

### Hard rules (section 2, short version)

1. Never without the human's explicit OK in chat: `git push`, making the repo public, mainnet deploys or transactions, spending mainnet tokens or paid API credits, posting anywhere, submitting the hackathon form. Testnet tokens are fine.
2. Never commit secrets. Keys live in `.env` (gitignored). Only `.env.example` holds placeholder names.
3. Never commit plaintext benchmark items. They live under `benchmarks/*/private/` (gitignored).
4. Never log, put in a URL, send to analytics or write to browser storage: key K, plaintext items, answers, rubrics, model outputs, per-item correctness.
5. No mocks in the demo path. In TypeScript, mocks are allowed only in test code behind `MOCK=1`, and production code must never read `MOCK`.
6. When a [VERIFY] item turns out different, fix the code and update `CLAUDE.md` and `AGENTS.md` in the same change.
7. Small commits with conventional messages: `feat(web): ...`, `fix(verifier): ...`, `test(shared): ...`.
8. Docs have no em dashes.
9. `request_eval` and `continue_dispatch` stay open until OutLayer's worker answers. Never wait for final execution and never retry them automatically, because a retry requests and pays for a second eval. Poll `get_eval` instead (section 7.3).
10. Every public function touching secrets gets a comment saying what it must never log or return.

### Working method

Turn every task into a check before starting (a failing test, a "done when" below), state a short plan, and report a task as done only after running the check and seeing it pass. Report failures as failures.

### Commands

```bash
pnpm install
pnpm --filter @blindmark/web dev          # http://localhost:3000 (also .claude/launch.json "web")
pnpm build                                # builds shared, verifier, web
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test                                 # vitest: packages/shared/test, packages/verifier/test, apps/web/lib/*.test.ts
pnpm --filter @blindmark/verifier build && pnpm blindmark verify 0
pnpm blindmark verify 0 --fetch-shards --json
```

### Network facts

| Item | Value |
|---|---|
| Network | testnet only |
| BlindMark contract | `blindmark.blindmark-jh-fe87ee.testnet` |
| OutLayer contract | `outlayer.testnet` |
| RPC | `https://rpc.testnet.fastnear.com` |
| Explorer | `https://testnet.nearblocks.io` |
| Frontend env | `NEXT_PUBLIC_NEAR_NETWORK`, `NEXT_PUBLIC_BLINDMARK_CONTRACT_ID` (see `.env.example`, `apps/web/lib/config.ts`) |
| Existing certificate | eval 0, made by the test-only stub grader (backend `test-stub-94149ba5`, score 0 by design). Not a real result |

---

## Progress log

### 2026-11-04: Phases 1 and 2 (commits `aedf392`, `8099b5b`, `dec0e4a` on `ui`, not pushed)

Checks run: `pnpm test` 48 passed, `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass. `pnpm blindmark verify 0` and `/certificates/0` report the same statuses (1, 2, 3, 5 PASS; 4, 6 WARN; 7 FAIL because the stub grader printed a wrong interval, as before).

| Task | Status | What was done |
|---|---|---|
| T1 shard storage | **Done** | Human chose FastFS. Recorded in `CLAUDE.md` and `AGENTS.md` section 4. Role 2 still has to confirm the grader WASM can fetch `https://test.fastfs.io/...` ([VERIFY]) |
| T2 automatic upload | **Done, not tried live** | Wizard step 3 "Upload with wallet": one `__fastdata_fastfs` call per file (shards, `protocol.json`, `manifest.json`, optional public samples) to the BlindMark contract, Borsh-encoded by `apps/web/lib/fastfs.ts`. The call fails on chain by design; the indexer serves the file at `https://test.fastfs.io/<owner>/<contract>/blindmark/bm<id>/v<version>/<file>`. URIs fill in automatically. Manual hosting kept as a fallback |
| T3 re-check before register | **Done** | After upload every file is fetched back and re-hashed (shard leaf hash, protocol hash), retried for about a minute while FastFS indexes. A wrong hash fails at once. Register is blocked until every line is PASS for the current URIs |
| T4 K secret in OutLayer | **Done, not tried live** | Wizard step 4 "Store K in outlayer.testnet" (`apps/web/lib/outlayer.ts`): keystore key from `POST https://testnet-api.outlayer.ai/secrets/pubkey` with `{"BLINDMARK_K":""}` (names only, never K), K encrypted in the browser with the keystore ECIES (X25519, HKDF-SHA256 `outlayer-keystore-v1`, ChaCha20-Poly1305), `store_secrets` with the section 8 condition and the deposit from `estimate_storage_cost`, then `get_secrets` must hold exactly that ciphertext. The testnet contract accepted the condition shape in `estimate_storage_cost`. Manual path and "Reveal K" kept inside a collapsed section |
| Profile fix | **Done** | Default secret profile is now `blindmark-bm<id>-v<version>`. The old shared default `blindmark-v1` would have let a second benchmark overwrite the first one's K |
| T5 live UI run | **Open, needs the human** | Needs a testnet wallet. Watch for: wallets showing the FastFS calls as failed (expected), wallets that reject raw byte arguments, and any resend of `request_eval` |
| T6 record decisions | **Done** | `CLAUDE.md` and `AGENTS.md` sections 4, 10 and 11; links in `docs/REFERENCES.md` |
| T7 check 4 | **Done** | Lists the grader project's jobs (`/public/jobs?project=`), reads each job's transaction from archival RPC, fetches `/attestations/<job_id>`, and keeps only inputs and outputs whose hashes the record commits to. Every shard and the aggregation must have an attested run that printed the stored result, ran `grader_measurement` and carries the eval's nonce. Other code, or an attested aggregate with other counts, is FAIL; no attestation is WARN. `/attestations/by-tx` returns one record per transaction, so it is not used |
| T8 check 5 | **Done** | For each accepted run: TDX quote verified to Intel's root with OutLayer's archived collateral (`@phala/dcap-qvl`), task hash recomputed and compared with `report_data`, measurements approved by `is_measurements_approved` on `worker.outlayer.testnet`. Eval 0: 3 of 3 runs verified, `UpToDate` |
| T9 check 6 | **Blocked on Role 2** | Needs the evidence bundle location (S5), an example bundle and the signed `text` format |
| T10 certificate page | **Done for checks 4 and 5** | Page runs the same fetcher and checks as the CLI, cached per certified eval (about 7 s first view, 1.5 s after). The verified-call share on the model hop waits on T9 |
| T11 browser shards vs grader | **Test done, live check blocked on Role 2** | New test ties `shardPlaintextBytes` and the envelope to the shared Rust vector. The real check (grader decrypts a browser shard) needs Role 2's grade mode |

New files: `apps/web/lib/fastfs.ts`, `apps/web/lib/outlayer.ts` (+ tests), `packages/verifier/src/attestation.ts`, `packages/verifier/src/fetch.ts`, `packages/verifier/test/attestation.test.ts`, `packages/verifier/test/fixtures/testnet-eval-0-outlayer.json` (real eval 0 jobs, attestations, payloads and collateral).

New dependencies: web `@noble/ciphers`, `@noble/hashes`, `@noble/curves`; verifier `@noble/hashes`, `@phala/dcap-qvl` 0.7.1. `next.config.ts` lists `@phala/dcap-qvl` in `serverExternalPackages`.

CLI change: OutLayer evidence is fetched by default; `--skip-attestations` turns it off.

Notes for the team:
- OutLayer's API moved to `https://testnet-api.outlayer.ai` (and `https://api.outlayer.ai`); the `outlayer.fastnear.com` hosts answer `api_moved`.
- The keystore key comes from an unauthenticated coordinator route and is not attested by the wizard; this is part of the OutLayer keystore trust assumption in the README limitations.
- `pnpm format:check` fails on 49 files repo-wide because `core.autocrlf=true` checks files out with CRLF. This predates this work; every file touched here passes Prettier.
- `.prettierignore` lists `CLAUDE.md` but not `AGENTS.md`, so `pnpm format` would reformat `AGENTS.md`.

Ask Role 2 for: FastFS fetchability from the grader WASM, the evidence bundle format and location (T9), and a date for the first real certificate (T11, T12).

---

## 1. Current state of Role 3 code

| Area | File | State |
|---|---|---|
| Shared crypto and types | `packages/shared/src/*.ts` | Done. `envelope.ts` (XChaCha20 shards, AAD), `merkle.ts`, `jcs.ts`, `protocol.ts`, `shards.ts` (`encryptBenchmark`, `shardFileName`, 50 items per shard, max 64 shards), `stats.ts` (`wilson`), `types.ts` and `eval.ts` (contract records). Cross-language vectors shared with Rust in `crates/blindmark-types/tests/vectors.json` |
| Owner wizard | `apps/web/app/benchmarks/new/wizard.tsx` | Done in code, not tried with a real wallet (T5). Steps: 1 inputs (JSONL, protocol), 2 encrypt and Merkle root, 3 upload to FastFS with the wallet (or host manually), then automatic re-hash of every file, 4 store K in OutLayer with `store_secrets` and confirm with `get_secrets` (manual path kept), 5 `register_benchmark` with 0.25 NEAR deposit, blocked until step 3 all PASS and step 4 done. Shards are encrypted for `predictNextBenchmarkId()`; a mismatched id is reported |
| Eval request | `apps/web/app/benchmarks/[id]/request-eval.tsx` | Done. Sends `request_eval` without awaiting, watches `get_eval` for the new eval, never resends |
| Eval status | `apps/web/app/evals/[id]/eval-status.tsx` | Done. Polls `get_eval`, buttons for `continue_dispatch` and `refund_expired` |
| Certificate page | `apps/web/app/certificates/[id]/page.tsx` | Done for checks 1 to 5 and 7. Runs `runChecks` server-side with the same OutLayer evidence as the CLI (`@blindmark/verifier/fetch`, cached per certified eval) and shows 4 data-path hops (checks 2+3, 4+5, 6, 1+7) with a badge each, plus a copyable verify command |
| Leaderboard | `apps/web/app/leaderboard/page.tsx`, `apps/web/lib/leaderboard.ts` (+ test) | Done with chain data. Latest certificate per model and benchmark, attempts count, error bars in CSS (`components/interval.tsx`) |
| Explorer, shell, wallet | `apps/web/app/page.tsx`, `components/*` | Done. Wallet picker in `components/wallet-modal.tsx`; `components/wallet.tsx` exposes `call(method, args, {deposit, tgas, receiverId, rawArgs})` and `sendTransactions(txs)` (batch, used for FastFS) |
| RPC helpers | `apps/web/lib/rpc.ts` | `view`, `viewOn(contract, method, args)` (OutLayer views), `listBenchmarks`, `listCertificates`, `getBenchmark`, `getEval`, `getCertificate`, `getBackends`, `getModels`, `getUsage`, `getEvalStorageDeposit`, `nextEvalId`, `predictNextBenchmarkId` |
| Verifier | `packages/verifier/src/checks.ts`, `attestation.ts`, `fetch.ts`, `cli.ts`, tests and fixtures in `test/` | Checks 1 to 5 and 7 real; check 4 and 5 verify OutLayer attestations and Intel TDX quotes (3 of 3 runs on eval 0). Check 6 only checks the count and format of `evidence_hashes` (T9 blocked). Tests fail fixtures with altered score, counts, commitments, wrong code hash, edited records, changed quote bytes and unapproved workers |

Not verified yet: the web pages have not been exercised against the testnet contract with a real wallet (T5).

---

## 2. Tasks

Status key: **TODO** can start now, **BLOCKED** waits on another role (named), **LATER** scheduled for a later day.

### Phase 1: Finish the upload flow (days 4 to 5)

#### T1. Choose shard storage (TODO, needs human decision)

- **Why:** `CLAUDE.md` section 4 lists shard storage as [TBD]: FastFS (preferred, OutLayer-friendly) or IPFS. Ciphertext only.
- **Constraints:** the grader (Role 2) fetches `shard_uri` and `protocol_uri` with HTTPS GET from inside OutLayer WASM. The contract stores `shard_uris: Vec<String>`, `protocol_uri`, `sample_items_uri`. URIs must be `https://` and serve the bytes unchanged. Up to 64 shards, each at most about 200 KiB plaintext.
- **Steps:**
  1. Research the FastFS upload API (how a browser or a NEAR wallet user uploads, what URL it serves from, whether it needs a key, CORS).
  2. Compare with IPFS through a pinning service (needs an API key; a key must not ship in the browser bundle, so it needs a server route in `apps/web/app/api/` or a user-supplied token).
  3. Present the comparison to the human. Ask Role 2 to confirm its WASM HTTP client can fetch the chosen URLs.
  4. Record the choice in section 4 of `CLAUDE.md` and `AGENTS.md`.
- **Done when:** the choice is recorded in both files and Role 2 has confirmed fetchability.

#### T2. Automatic upload in wizard step 3 (TODO after T1)

- **Where:** `apps/web/app/benchmarks/new/wizard.tsx`, step 3 "Host the public files". Keep download buttons as a fallback.
- **Steps:**
  1. Add an "Upload" action that uploads every `built.encrypted.shards[i].ciphertext` (named with `shardFileName(i)`), `protocol.json` (`built.protocolText`), `manifest.json` and optional public samples.
  2. Fill `shardUris`, `protocolUri` and `samplesUri` from the upload results instead of the base URL input. `shard_uris` must be in `shard_index` order.
  3. Upload only ciphertext and public files. K and plaintext never leave the browser.
  4. Show progress per file and fixed, non-sensitive error text.
- **Done when:** a JSONL file goes through steps 1 to 3 with no manual hosting, and the URIs are filled.

#### T3. Re-check uploaded files before registering (TODO after T2)

- **Where:** existing `checkHosting()` in `wizard.tsx`.
- **Steps:** run it automatically after upload. For each shard check `toHex(leafHash(fetched)) === shard.hash` (leaf hash is `sha256(0x00 || ciphertext)`, section 5.4). Check `protocolHash(fetched JSON) === built.protocolHash` (`sha256(JCS(protocol))`, section 5.2). Block step 5 (`register_benchmark`) unless every line is PASS.
- **Done when:** registering is impossible while any shard or the protocol fails or cannot be fetched, and a corrupted upload shows FAIL.

#### T4. K secret creation in OutLayer (TODO, research)

- **Where:** wizard step 4 "Lock K in OutLayer".
- **Spec:** secret env var name `BLINDMARK_K` (hex of the 32-byte K), owned by the benchmark owner's account, profile name stored in `secret_ref.profile`. Access condition (section 8):
  `{"Logic":{"operator":"And","conditions":[{"WasmHash":{"hash":"<approved grader sha256>"}},{"Predecessor":{"condition":{"Whitelist":{"accounts":["<blindmark contract>"]}}}}]}}`
  The grader hash is the chosen backend's `measurement`. The `Predecessor` wrapper is essential. Section 11: K may leave the browser only encrypted to the OutLayer keystore key.
- **Steps:**
  1. Find out from OutLayer docs (links in `docs/REFERENCES.md`) whether secrets can be created by API or contract call from the browser, and how the value is encrypted to the keystore key.
  2. If yes: implement it in step 4 behind a wallet call, encrypting K client-side to the keystore key, and drop the manual checkbox.
  3. If no: keep the manual step, make the instructions exact (where to click on the OutLayer Secrets page, what to paste).
  4. Either way, replace the "[VERIFY: OutLayer API or Secrets page]" note in section 11 of `CLAUDE.md` and `AGENTS.md` with the finding.
- **Coordinate:** Role 2 runs spike S4 (this condition tested live). Use its result.
- **Done when:** the finding is recorded, and step 4 either creates the secret or gives exact manual steps.

#### T5. First live run of the UI on testnet (TODO)

- **Steps:**
  1. Start `pnpm --filter @blindmark/web dev`, connect a testnet wallet (Sender, OKX, Bitget or Nightly extension).
  2. Register a tiny benchmark (a few items from a local, gitignored JSONL; never commit it).
  3. Open `/benchmarks/<id>`, request an eval against the active backend, confirm the page moves to `/evals/<id>` and polls.
  4. Watch for the wallet re-signing or resending `request_eval` after a timeout (section 7.3 warns that some clients do). If it happens, fix it in `components/wallet.tsx` and record which wallet did it.
  5. Note: until Role 2's grader exists, the only active backend may be the test-only stub (score 0). That is fine for a UI test but is never the demo path.
- **Done when:** benchmark registered from the browser, one eval requested and visible on `/evals/<id>`, results written down (tx hashes, any bugs).

#### T6. Record decisions (TODO, with each task)

Update `CLAUDE.md` and `AGENTS.md` in the same commit as each decision (T1 storage, T4 secret flow, any wallet behaviour from T5).

### Phase 2: Verifier and certificate page (days 6 to 7)

Verifier spec (section 10): `pnpm blindmark verify <eval_id> [--network testnet] [--contract <account>] [--json]`. Each check prints PASS, FAIL or WARN, exit code non-zero on any FAIL, readable by an AI judge in under a minute. A check that cannot run is WARN, never PASS. Keep `checks.ts` pure (data in, results out) so tests run on fixtures; network fetching belongs in `cli.ts`. The certificate page reuses `runChecks`, so new checks show there too.

#### T7. Check 4: OutLayer execution attestation (TODO, research first)

- **Spec:** certificate `grader_measurement` equals its backend's `measurement` (already done; WARN if backend inactive). Add: OutLayer execution attestations report that code hash [VERIFY API in OutLayer TEE attestation docs].
- **Steps:** find the OutLayer API that returns per-execution attestation for the eval's runs (the transactions are on-chain via the contract's dispatches). Fetch it in `cli.ts`, pass it into `runChecks` through `OffChainData`, compare the code hash. Add fixture tests for match and mismatch.
- **Done when:** check 4 passes or fails on attestation data instead of warning, with tests.

#### T8. Check 5: Intel TDX evidence (TODO, research first)

- **Spec:** verify the OutLayer TDX evidence; optionally the NEAR AI Intel Trust Authority JWT with `jose`. Allowed new deps: `jose`, `@noble/curves` (ed25519 only).
- **Done when:** check 5 verifies real evidence or clearly states what was verified, with fixture tests. If full TDX quote verification is not feasible in Node in time, verify what is possible and keep the rest WARN with an exact reason.

#### T9. Check 6: model evidence (BLOCKED on Role 2 evidence bundle and spike S5)

- **Spec (section 6):** each shard's evidence bundle is JSON stored off-chain; its sha256 is in `certificate.evidence_hashes[i]`. Shape:
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
- **Steps:** fetch each bundle (location decided by S5), check sha256 equals `evidence_hashes[i]`, check `nonce` matches the eval's nonce, verify the NEAR AI model report and extract its signing key, verify each `provider_tee` signature over `text` with `@noble/curves` ed25519, report "x of y calls verified". If `text` is left out (section 6 [VERIFY]), rebuild it per Role 2's format.
- **Rules:** hash mismatch or bad signature is FAIL. Missing signature or missing bundle (S5 fallback) is WARN and never counts as verified.
- **Ask Role 2 now for:** where bundles are stored, an example bundle, and how the signed `text` is built.
- **Done when:** check 6 reports the verified share on a real bundle, with fixture tests for good, tampered and missing.

#### T10. Certificate page shows real evidence (TODO after T7 to T9)

- **Where:** `apps/web/app/certificates/[id]/page.tsx` (hops already map to check ids).
- **Steps:** pass the off-chain data the CLI fetches into `runChecks` server-side, show each check's detail lines under its hop, show the verified-call share on the "Model in NEAR AI TEE" hop.
- **Done when:** the page and `pnpm blindmark verify <id>` report the same statuses for the same eval.

#### T11. Browser-encrypted shards decrypt in the real grader (BLOCKED on Role 2 grader)

- **Spec:** ciphertext `0x01 || nonce(24) || XChaCha20-Poly1305(K, nonce, plaintext, aad)`, `aad = "blindmark:v1:" + benchmark_id + ":" + version + ":" + shard_index`, plaintext `{"benchmark_id","version","shard_index","items":[...]}` compact JSON (section 5.3).
- **Steps:** once Role 2 has grade mode, run one eval on a benchmark registered through the wizard. Meanwhile, add a TS test that encrypts with `encryptBenchmark` and checks the bytes against the shared vectors.
- **Done when:** the real grader returns `ok: true` for a browser-encrypted shard. This completes must-have 3.

### Phase 3: Checkpoint (day 8)

#### T12. Verifier passes on a real certificate (BLOCKED on Role 2)

- **Done when:** `pnpm blindmark verify <id>` prints no FAIL on a certificate from the real grader (WARN allowed only with stated reasons), and still exits non-zero on the altered fixture in `packages/verifier/test/`. Save the output; it goes in the README. This completes must-have 4.

#### T13. Help if Part 1 is not end to end (LATER)

If the checkpoint fails, help Role 2 debug the path browser shards to grader to contract before doing Phase 4.

### Phase 4: Leaderboard and polish (days 9 to 11)

#### T14. Leaderboard with real data (LATER)

- **Rules (section 11, 5.5):** show each model's latest certificate per benchmark and its number of attempts, never its best. Label two models "statistically tied" when their Wilson intervals overlap.
- **Done when:** checked against at least two real certificates; `apps/web/lib/leaderboard.test.ts` covers latest-not-best and ties.

#### T15. Hardening (LATER)

- Empty, loading and error states on every route with live data.
- Grep `apps/web` for any path where K or plaintext could reach `console`, URLs, `localStorage`, `sessionStorage` or analytics. Remove it.
- Confirm `request_eval` and `continue_dispatch` are never awaited for final execution or retried.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.

#### T16. Part 2 in the UI (LATER, only if Part 2 goes ahead after day 8)

Show `ShadeDstack` backends and trust tier on certificates and the leaderboard.

#### T17. Should-haves (LATER, only if ahead)

Contamination demo (public original versus hidden perturbed scores), attested benchmark card (item count, reference baselines), cost and latency on certificates.

### Phase 5: Demo and launch (days 12 to 13)

#### T18. `docs/DEMO.md` (LATER)

Step-by-step demo script: owner uploads, model team requests an eval, live status, certificate, verify command, tamper test.

#### T19. Demo video (LATER)

Record the script from T18 on testnet. The tamper test part is done with Role 2 (section 8: tampered build cannot read K, and cannot produce a certificate through the contract).

#### T20. X post draft (LATER)

Draft only. The human posts it (hard rule 1).

#### T21. README sections (LATER)

Write "Try it" ("do X, see Y" steps on testnet) and "Verify a certificate" (one command plus sample output from T12). Other README sections belong to Roles 1, 2 and 4 (section 18 order). Note: `README.md` currently says the verifier is a stub, which is out of date.

### Phase 6: Buffer (day 14)

#### T22. Clean checkout run (LATER)

Follow the README "Try it" steps from a fresh clone, fix anything broken, help Role 1 submit (Role 1 submits; never submit yourself).

---

## 3. Dependencies on other roles

| Need | From | For |
|---|---|---|
| Confirm WASM can fetch the chosen storage URLs | Role 2 | T1 |
| Spike S4 result (secret condition live) | Role 2 | T4 |
| Evidence bundle location (S5), example bundle, signed `text` format | Role 2 | T9 |
| Working grade and aggregate modes | Role 2 | T11, T12 |
| Real backend registered on the contract (not the stub) | Role 1 | T5 (real path), T12 |
| math-v1 benchmark items | Role 4 | demo, T19 |

Main risk: T9, T11 and T12 depend on Role 2's grader. Ask Role 2 early for the evidence bundle format and a date for the first real certificate.
