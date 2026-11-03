//! Integration tests: the real BlindMark contract and OutLayer's real contract in a local
//! sandbox, with the test playing OutLayer's worker. OutLayer's contract (Apache-2.0) is fetched
//! from testnet at run time and never committed. Needs network access on the first run.
//!
//! Run: `cargo test -p blindmark-contract --test sandbox -- --nocapture` to also see gas.

#![allow(clippy::unwrap_used)] // `allow-unwrap-in-tests` does not reach helper functions here.

use blindmark_types::merkle::{leaf_hash, root};
use blindmark_types::wire::{AggregateRequest, AggregateResult, GradeRequest, GradeResult};
use near_workspaces::network::Sandbox;
use near_workspaces::operations::TransactionStatus;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{Value, json};

const MEASUREMENT: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const EVIDENCE: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const PROTOCOL_HASH: &str = "3333333333333333333333333333333333333333333333333333333333333333";
const PRICE: u128 = 1_000_000_000_000_000_000_000_000;
const SHARDS: usize = 4;

struct World {
    worker: Worker<Sandbox>,
    outlayer: Contract,
    operator: Account,
    blindmark: Contract,
    owner: Account,
    treasury: Account,
    requester: Account,
}

async fn account(worker: &Worker<Sandbox>, name: &str, near: u128) -> Account {
    worker
        .root_account()
        .unwrap()
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(near))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap()
}

fn assert_ok(label: &str, outcome: &ExecutionFinalResult) {
    assert!(
        outcome.is_success() && outcome.receipt_failures().is_empty(),
        "{label} failed: {:#?}",
        outcome.receipt_failures()
    );
}

/// Gas burnt by the BlindMark receipt that ran the method itself.
fn method_gas_tgas(outcome: &ExecutionFinalResult, contract: &Contract) -> f64 {
    outcome
        .receipt_outcomes()
        .iter()
        .find(|o| o.executor_id == *contract.id())
        .map(|o| o.gas_burnt.as_gas() as f64 / 1e12)
        .unwrap_or_default()
}

fn shard_hashes() -> Vec<String> {
    (0..SHARDS)
        .map(|i| hex::encode(leaf_hash(format!("ciphertext-{i}").as_bytes())))
        .collect()
}

async fn setup(version_key_exists: bool) -> World {
    let worker = near_workspaces::sandbox().await.unwrap();
    let testnet = near_workspaces::testnet().await.unwrap();
    let outlayer_code = testnet
        .view_code(&"outlayer.testnet".parse().unwrap())
        .await
        .unwrap();

    let operator = account(&worker, "operator", 50).await;
    let outlayer = account(&worker, "outlayer", 50)
        .await
        .deploy(&outlayer_code)
        .await
        .unwrap()
        .into_result()
        .unwrap();
    assert_ok(
        "outlayer init",
        &outlayer
            .call("new")
            .args_json(json!({ "owner_id": operator.id(), "operator_id": operator.id() }))
            .transact()
            .await
            .unwrap(),
    );

    // The grader project. Its only version's key is the WASM hash, as S6 showed live.
    let grader = account(&worker, "grader", 50).await;
    let version_hash = if version_key_exists {
        MEASUREMENT
    } else {
        EVIDENCE
    };
    assert_ok(
        "create_project",
        &grader
            .call(outlayer.id(), "create_project")
            .args_json(json!({
                "name": "grader",
                "source": { "WasmUrl": {
                    "url": "https://example.test/grader.wasm",
                    "hash": version_hash,
                    "build_target": "wasm32-wasip2",
                } },
            }))
            .deposit(NearToken::from_millinear(100))
            .gas(Gas::from_tgas(100))
            .transact()
            .await
            .unwrap(),
    );

    let admin = account(&worker, "admin", 20).await;
    let owner = account(&worker, "owner", 20).await;
    let treasury = account(&worker, "treasury", 20).await;
    let requester = account(&worker, "requester", 50).await;
    let wasm = near_workspaces::compile_project("./").await.unwrap();
    let blindmark = account(&worker, "blindmark", 50)
        .await
        .deploy(&wasm)
        .await
        .unwrap()
        .into_result()
        .unwrap();
    assert_ok(
        "blindmark init",
        &blindmark
            .call("new")
            .args_json(json!({
                "admin": admin.id(), "outlayer_contract": outlayer.id(),
                "treasury": treasury.id(), "platform_fee_bps": 500,
            }))
            .transact()
            .await
            .unwrap(),
    );
    for (method, args) in [
        (
            "add_backend",
            json!({ "backend": {
                "id": "outlayer-v1", "kind": "OutLayer", "measurement": MEASUREMENT,
                "outlayer_project": format!("{}/grader", grader.id()), "active": true,
            } }),
        ),
        (
            "add_model",
            json!({ "model": { "id": "model-a", "tier": "A", "active": true } }),
        ),
    ] {
        assert_ok(
            method,
            &admin
                .call(blindmark.id(), method)
                .args_json(args)
                .transact()
                .await
                .unwrap(),
        );
    }

    let hashes = shard_hashes();
    let leaves: Vec<[u8; 32]> = (0..SHARDS)
        .map(|i| leaf_hash(format!("ciphertext-{i}").as_bytes()))
        .collect();
    assert_ok(
        "register_benchmark",
        &owner
            .call(blindmark.id(), "register_benchmark")
            .args_json(json!({ "args": {
                "version": 1, "title": "math", "description": "math", "grading_type": "numeric",
                "dataset_root": hex::encode(root(&leaves).unwrap()),
                "protocol_hash": PROTOCOL_HASH,
                "protocol_uri": "https://example.test/protocol.json",
                "shard_uris": (0..SHARDS).map(|i| format!("https://example.test/{i}.bin")).collect::<Vec<_>>(),
                "shard_hashes": hashes,
                "item_count": 500, "sample_items_uri": null,
                "price": PRICE.to_string(),
                "secret_ref": { "owner": owner.id(), "profile": "math-k" },
                "max_evals_per_model": null, "cooldown_ns": null,
            } }))
            .deposit(NearToken::from_near(1))
            .gas(Gas::from_tgas(100))
            .transact()
            .await
            .unwrap(),
    );

    World {
        worker,
        outlayer,
        operator,
        blindmark,
        owner,
        treasury,
        requester,
    }
}

impl World {
    async fn view(&self, method: &str, args: Value) -> Value {
        self.blindmark
            .view(method)
            .args_json(args)
            .await
            .unwrap()
            .json()
            .unwrap()
    }

    async fn eval(&self) -> Value {
        self.view("get_eval", json!({ "id": 0 })).await
    }

    async fn pending(&self) -> Vec<(u64, Value)> {
        let ids: Vec<u64> = self
            .outlayer
            .view("get_pending_request_ids")
            .args_json(json!({ "from_index": 0, "limit": 100 }))
            .await
            .unwrap()
            .json()
            .unwrap();
        let mut out = Vec::new();
        for id in ids {
            let request: Value = self
                .outlayer
                .view("get_request")
                .args_json(json!({ "request_id": id }))
                .await
                .unwrap()
                .json()
                .unwrap();
            out.push((id, request));
        }
        out
    }

    /// Polls until `check` holds. Calls that dispatch OutLayer runs stay unfinished until the
    /// worker answers (yield/resume), so tests send them async and wait on state instead.
    async fn wait_for(&self, what: &str, check: impl AsyncFn(&World) -> bool) {
        for _ in 0..120 {
            if check(self).await {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        panic!("timed out waiting for {what}");
    }

    async fn pending_count(&self) -> usize {
        self.pending().await.len()
    }

    /// Sends `request_eval` without waiting for it to finish, which it cannot do before the
    /// worker answers. Waiting would hit the RPC timeout, and `near-workspaces` would then
    /// re-sign and send a second eval request.
    async fn request_eval(&self) -> TransactionStatus {
        let storage: String = self
            .view("eval_storage_deposit", json!({ "shard_count": SHARDS }))
            .await
            .as_str()
            .unwrap()
            .to_string();
        let budget = (SHARDS as u128 + 1 + 3) * 20_000_000_000_000_000_000_000;
        let deposit = PRICE + budget + storage.parse::<u128>().unwrap();
        self.requester
            .call(self.blindmark.id(), "request_eval")
            .args_json(
                json!({ "benchmark_id": 0, "model_id": "model-a", "backend_id": "outlayer-v1" }),
            )
            .deposit(NearToken::from_yoctonear(deposit))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await
            .unwrap()
    }

    async fn continue_dispatch(&self) -> TransactionStatus {
        self.requester
            .call(self.blindmark.id(), "continue_dispatch")
            .args_json(json!({ "eval_id": 0 }))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await
            .unwrap()
    }

    /// Plays OutLayer's worker: resolves a pending request with JSON output, or with a failed
    /// run (`None`), which OutLayer turns into `null` for the caller. Waits until OutLayer's
    /// callback, which runs in a later block, has removed the request.
    async fn resolve(&self, request_id: u64, output: Option<Value>) {
        self.send_resolution(request_id, output).await;
        self.wait_for("OutLayer's callback", async |w| {
            !w.pending().await.iter().any(|(id, _)| *id == request_id)
        })
        .await;
    }

    async fn send_resolution(&self, request_id: u64, output: Option<Value>) {
        let response = json!({
            "success": output.is_some(),
            "output": output.map(|value| json!({ "Json": value })),
            "error": null,
            "resources_used": { "instructions": 1000, "time_ms": 100, "compile_time_ms": null },
            "compilation_note": null,
        });
        assert_ok(
            "resolve_execution",
            &self
                .operator
                .call(self.outlayer.id(), "resolve_execution")
                .args_json(json!({ "request_id": request_id, "response": response }))
                .gas(Gas::from_tgas(300))
                .transact()
                .await
                .unwrap(),
        );
    }

    /// Answers every pending grade request the way a correct grader would.
    async fn grade_all_pending(&self) -> usize {
        let pending = self.pending().await;
        for (id, request) in &pending {
            let grade: GradeRequest =
                serde_json::from_str(request["input_data"].as_str().unwrap()).unwrap();
            let result = GradeResult {
                eval_id: grade.eval_id,
                shard_index: grade.shard_index,
                shard_hash: grade.shard_hash,
                sealed_partial: format!("sealed-{}", grade.shard_index),
                evidence_hash: EVIDENCE.to_string(),
                backend: "outlayer-v1".to_string(),
                ok: true,
                error: None,
            };
            self.resolve(*id, Some(serde_json::to_value(result).unwrap()))
                .await;
        }
        pending.len()
    }

    async fn balance(&self, account: &Account) -> u128 {
        account.view_account().await.unwrap().balance.as_yoctonear()
    }
}

#[tokio::test]
async fn full_eval_through_real_outlayer_contract() {
    let world = setup(true).await;

    let requested = world.request_eval().await;
    world
        .wait_for("3 runs at OutLayer", async |w| w.pending_count().await == 3)
        .await;

    // What OutLayer actually stored for our run: pinned, limited, paid back to the requester.
    let pending = world.pending().await;
    let (_, first) = &pending[0];
    assert_eq!(
        first["execution_source"]["Project"]["version_key"],
        MEASUREMENT
    );
    assert_eq!(first["payer_account_id"], world.requester.id().to_string());
    assert_eq!(first["response_format"], "Json");
    assert_eq!(first["secrets_ref"]["profile"], "math-k");
    assert_eq!(first["resource_limits"]["max_execution_seconds"], 180);

    assert_eq!(world.grade_all_pending().await, 3);
    let requested = requested.await.unwrap();
    assert_ok("request_eval", &requested);
    println!(
        "request_eval with 3 dispatches: BlindMark receipt burnt {:.1} Tgas, transaction total {:.1} Tgas",
        method_gas_tgas(&requested, &world.blindmark),
        requested.total_gas_burnt.as_gas() as f64 / 1e12
    );

    let continued = world.continue_dispatch().await;
    world
        .wait_for("the 4th run", async |w| w.pending_count().await == 1)
        .await;
    assert_eq!(world.grade_all_pending().await, 1);
    assert_ok("continue_dispatch", &continued.await.unwrap());
    assert_eq!(world.eval().await["status"], "Grading");

    let owner_before = world.balance(&world.owner).await;
    let treasury_before = world.balance(&world.treasury).await;
    let aggregating = world.continue_dispatch().await;
    world
        .wait_for("the aggregate run", async |w| w.pending_count().await == 1)
        .await;
    assert_eq!(world.eval().await["status"], "Aggregating");
    let pending = world.pending().await;
    assert_eq!(pending.len(), 1);
    let (id, request) = &pending[0];
    assert!(
        request["secrets_ref"].is_null(),
        "aggregation must not receive K"
    );
    let aggregate: AggregateRequest =
        serde_json::from_str(request["input_data"].as_str().unwrap()).unwrap();
    assert_eq!(aggregate.sealed_partials.len(), SHARDS);
    let result = AggregateResult {
        eval_id: 0,
        n_items: 500,
        n_correct: 361,
        score_bps: 7220,
        ci_low_bps: 6812,
        ci_high_bps: 7595,
        mean_latency_ms: 1840,
        ok: true,
        error: None,
    };
    world
        .resolve(*id, Some(serde_json::to_value(result).unwrap()))
        .await;
    assert_ok("aggregation", &aggregating.await.unwrap());

    assert_eq!(world.eval().await["status"], "Certified");
    let cert = world.view("get_certificate", json!({ "eval_id": 0 })).await;
    assert_eq!(cert["score_bps"], 7220);
    assert_eq!(cert["grader_measurement"], MEASUREMENT);
    let fee = PRICE * 500 / 10_000;
    world
        .wait_for("the payout", async |w| {
            w.balance(&w.treasury).await > treasury_before
        })
        .await;
    assert_eq!(world.balance(&world.treasury).await - treasury_before, fee);
    assert_eq!(
        world.balance(&world.owner).await - owner_before,
        PRICE - fee
    );
    let _ = &world.worker;
}

#[tokio::test]
async fn lost_run_is_retried_through_real_outlayer_contract() {
    let world = setup(true).await;
    let _requested = world.request_eval().await;
    world
        .wait_for("3 runs at OutLayer", async |w| w.pending_count().await == 3)
        .await;
    let pending = world.pending().await;
    let (lost_id, lost) = &pending[0];
    let lost_shard: GradeRequest =
        serde_json::from_str(lost["input_data"].as_str().unwrap()).unwrap();
    world.resolve(*lost_id, None).await;

    let eval = world.eval().await;
    assert_eq!(eval["retries_left"], 2);
    assert_eq!(eval["retry_shards"], json!([lost_shard.shard_index]));

    world.grade_all_pending().await;
    let _resend = world.continue_dispatch().await;
    world
        .wait_for("the retry and the 4th shard", async |w| {
            w.pending_count().await == 2
        })
        .await;
    let resent = world.pending().await;
    let first: GradeRequest =
        serde_json::from_str(resent[0].1["input_data"].as_str().unwrap()).unwrap();
    assert_eq!(
        first.shard_index, lost_shard.shard_index,
        "retries go first"
    );
    world.grade_all_pending().await;
    let _aggregate = world.continue_dispatch().await;
    world
        .wait_for("aggregation", async |w| {
            w.eval().await["status"] == "Aggregating"
        })
        .await;
}

#[tokio::test]
async fn unknown_pinned_version_fails_and_refunds() {
    // The project has no version whose key is the backend's measurement.
    let world = setup(false).await;
    let contract_before = world
        .blindmark
        .view_account()
        .await
        .unwrap()
        .balance
        .as_yoctonear();
    let requested = world.request_eval().await.await.unwrap();
    // The transaction succeeds; only OutLayer's receipts fail ("Version not found").
    assert!(requested.is_success());
    world
        .wait_for("the eval to fail", async |w| {
            w.eval().await["status"] == "Failed"
        })
        .await;
    assert!(world.pending().await.is_empty());
    let contract_after = world
        .blindmark
        .view_account()
        .await
        .unwrap()
        .balance
        .as_yoctonear();
    println!(
        "contract balance change across a request whose 3 runs failed: {:.4} NEAR",
        (contract_after as f64 - contract_before as f64) / 1e24
    );

    let refunded = world
        .owner
        .call(world.blindmark.id(), "refund_expired")
        .args_json(json!({ "eval_id": 0 }))
        .transact()
        .await
        .unwrap();
    assert_ok("refund_expired", &refunded);
    assert_eq!(world.eval().await["status"], "Refunded");
    // Price plus the 5 runs never dispatched. Read from the transfer the refund created, because
    // the requester's balance also moves with gas refunds from earlier transactions.
    let expected = PRICE + 5 * 20_000_000_000_000_000_000_000;
    let event = refunded
        .logs()
        .into_iter()
        .find_map(|log| log.strip_prefix("EVENT_JSON:"))
        .map(|body| serde_json::from_str::<Value>(body).unwrap())
        .unwrap();
    assert_eq!(event["event"], "eval_refunded");
    assert_eq!(event["data"]["amount"], expected.to_string());
}
