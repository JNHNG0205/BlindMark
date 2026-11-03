//! Unit tests for section 7. They inspect the receipts the contract creates, so they check the
//! exact OutLayer arguments and payout amounts. OutLayer's replies are injected as promise results.

use super::*;
use blindmark_types::merkle::{leaf_hash, root};
use blindmark_types::wire::{AggregateResult, GradeResult};
use near_sdk::json_types::{U64, U128};
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::{Gas, NearToken, PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const MEASUREMENT: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const EVIDENCE: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const PROTOCOL_HASH: &str = "3333333333333333333333333333333333333333333333333333333333333333";
const PRICE: u128 = 1_000_000_000_000_000_000_000_000;
const START_NS: u64 = 1_000_000_000_000;
const HOUR_NS: u64 = 60 * 60 * 1_000_000_000;

fn acct(name: &str) -> AccountId {
    format!("{name}.testnet").parse().unwrap()
}

/// Sets the caller, deposit and time for the next call, with an optional promise result.
fn call_env(caller: &str, deposit: u128, now: u64, result: Option<PromiseResult>) {
    let context = VMContextBuilder::new()
        .current_account_id(acct("blindmark"))
        .signer_account_id(acct(caller))
        .predecessor_account_id(acct(caller))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now)
        .block_height(100 + now / 1_000_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .random_seed([7; 32])
        .build();
    testing_env!(
        context,
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        result.into_iter().collect()
    );
}

fn as_user(caller: &str) {
    call_env(caller, 0, START_NS, None);
}

fn hashes(count: usize) -> Vec<String> {
    (0..count)
        .map(|i| hex::encode(leaf_hash(format!("ciphertext-{i}").as_bytes())))
        .collect()
}

fn benchmark_args(shard_count: usize) -> RegisterBenchmarkArgs {
    let shard_hashes = hashes(shard_count);
    let leaves: Vec<[u8; 32]> = (0..shard_count)
        .map(|i| leaf_hash(format!("ciphertext-{i}").as_bytes()))
        .collect();
    let dataset_root = root(&leaves).map(hex::encode).unwrap_or_default();
    RegisterBenchmarkArgs {
        version: 1,
        title: "math".to_string(),
        description: "math benchmark".to_string(),
        grading_type: "numeric".to_string(),
        dataset_root,
        protocol_hash: PROTOCOL_HASH.to_string(),
        protocol_uri: "https://example.test/protocol.json".to_string(),
        shard_uris: (0..shard_count)
            .map(|i| format!("https://example.test/shard-{i}.bin"))
            .collect(),
        shard_hashes,
        item_count: 500,
        sample_items_uri: None,
        price: U128(PRICE),
        secret_ref: SecretRef {
            owner: acct("owner"),
            profile: "math-k".to_string(),
        },
        max_evals_per_model: None,
        cooldown_ns: None,
    }
}

fn new_contract() -> BlindMark {
    as_user("admin");
    let mut contract = BlindMark::new(acct("admin"), acct("outlayer"), acct("treasury"), 500);
    contract.add_backend(Backend {
        id: "outlayer-v1".to_string(),
        kind: BackendKind::OutLayer,
        measurement: MEASUREMENT.to_string(),
        outlayer_project: Some("grader.testnet/grader".to_string()),
        active: true,
    });
    contract.add_model(ModelInfo {
        id: "model-a".to_string(),
        tier: "A".to_string(),
        active: true,
    });
    contract
}

const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn with_benchmark(shard_count: usize) -> (BlindMark, u64) {
    let mut contract = new_contract();
    call_env("owner", ONE_NEAR, START_NS, None);
    let id = contract.register_benchmark(benchmark_args(shard_count));
    (contract, id)
}

fn required_deposit(contract: &BlindMark, shard_count: u32) -> u128 {
    PRICE
        + (shard_count as u128 + 1 + MAX_RETRIES as u128) * COMPUTE_PER_RUN
        + contract.eval_storage_deposit(shard_count).0
}

fn with_eval(shard_count: usize) -> (BlindMark, u64) {
    let (mut contract, benchmark_id) = with_benchmark(shard_count);
    let deposit = required_deposit(&contract, shard_count as u32);
    call_env("requester", deposit, START_NS, None);
    let eval_id = contract.request_eval(
        benchmark_id,
        "model-a".to_string(),
        "outlayer-v1".to_string(),
    );
    (contract, eval_id)
}

fn grade_result(eval_id: u64, shard_index: u32) -> GradeResult {
    GradeResult {
        eval_id,
        shard_index,
        shard_hash: hashes(shard_index as usize + 1)[shard_index as usize].clone(),
        sealed_partial: format!("sealed-{shard_index}"),
        evidence_hash: EVIDENCE.to_string(),
        backend: "outlayer-v1".to_string(),
        ok: true,
        error: None,
    }
}

fn aggregate_result(eval_id: u64) -> AggregateResult {
    AggregateResult {
        eval_id,
        n_items: 500,
        n_correct: 361,
        score_bps: 7220,
        ci_low_bps: 6812,
        ci_high_bps: 7595,
        mean_latency_ms: 1840,
        ok: true,
        error: None,
    }
}

fn success<T: near_sdk::serde::Serialize>(value: &T) -> Option<PromiseResult> {
    Some(PromiseResult::Successful(
        serde_json::to_vec(value).unwrap(),
    ))
}

fn null_result() -> Option<PromiseResult> {
    Some(PromiseResult::Successful(b"null".to_vec()))
}

fn deliver_shard(contract: &mut BlindMark, eval_id: u64, shard_index: u32) {
    call_env(
        "blindmark",
        0,
        START_NS,
        success(&grade_result(eval_id, shard_index)),
    );
    contract.on_shard_graded(eval_id, shard_index);
}

fn keep_dispatching(contract: &mut BlindMark, eval_id: u64) {
    while contract.get_eval(eval_id).unwrap().status == EvalStatus::Dispatching {
        as_user("anyone");
        contract.continue_dispatch(eval_id);
    }
}

/// Runs an eval up to the point where the aggregate run is in flight.
fn to_aggregating(shard_count: usize) -> (BlindMark, u64) {
    let (mut contract, eval_id) = with_eval(shard_count);
    keep_dispatching(&mut contract, eval_id);
    for i in 0..shard_count as u32 {
        deliver_shard(&mut contract, eval_id, i);
    }
    as_user("anyone");
    contract.continue_dispatch(eval_id);
    (contract, eval_id)
}

fn certified(shard_count: usize) -> (BlindMark, u64) {
    let (mut contract, eval_id) = to_aggregating(shard_count);
    call_env(
        "blindmark",
        0,
        START_NS,
        success(&aggregate_result(eval_id)),
    );
    contract.on_aggregated(eval_id);
    (contract, eval_id)
}

fn status(contract: &BlindMark, eval_id: u64) -> EvalStatus {
    contract.get_eval(eval_id).unwrap().status
}

struct Call {
    receiver: AccountId,
    method: String,
    args: Value,
    deposit: u128,
    gas: u64,
}

fn function_calls() -> Vec<Call> {
    let mut calls = Vec::new();
    for receipt in get_created_receipts() {
        for action in receipt.actions {
            if let MockAction::FunctionCallWeight {
                method_name,
                args,
                attached_deposit,
                prepaid_gas,
                ..
            } = action
            {
                calls.push(Call {
                    receiver: receipt.receiver_id.clone(),
                    method: String::from_utf8(method_name).unwrap(),
                    args: serde_json::from_slice(&args).unwrap_or(Value::Null),
                    deposit: attached_deposit.as_yoctonear(),
                    gas: prepaid_gas.as_tgas(),
                });
            }
        }
    }
    calls
}

fn execution_calls() -> Vec<Call> {
    function_calls()
        .into_iter()
        .filter(|c| c.method == "request_execution")
        .collect()
}

fn transfers() -> Vec<(AccountId, u128)> {
    let mut out = Vec::new();
    for receipt in get_created_receipts() {
        for action in receipt.actions {
            if let MockAction::Transfer { deposit, .. } = action {
                out.push((receipt.receiver_id.clone(), deposit.as_yoctonear()));
            }
        }
    }
    out
}

fn transferred_to(name: &str) -> u128 {
    transfers()
        .into_iter()
        .filter(|(account, _)| *account == acct(name))
        .map(|(_, amount)| amount)
        .sum()
}

fn input_of(call: &Call) -> Value {
    serde_json::from_str(call.args["input_data"].as_str().unwrap()).unwrap()
}

fn has_event(name: &str) -> bool {
    get_logs().iter().any(|log| {
        log.strip_prefix("EVENT_JSON:")
            .and_then(|body| serde_json::from_str::<Value>(body).ok())
            .is_some_and(|event| {
                event["standard"] == "blindmark"
                    && event["version"] == "1.0.0"
                    && event["event"] == name
            })
    })
}

// ---------- init and admin ----------

#[test]
fn new_stores_config() {
    as_user("admin");
    let contract = BlindMark::new(acct("admin"), acct("outlayer"), acct("treasury"), 500);
    assert_eq!(contract.admin, acct("admin"));
    assert_eq!(contract.outlayer_contract, acct("outlayer"));
    assert_eq!(contract.treasury, acct("treasury"));
    assert_eq!(contract.platform_fee_bps, 500);
}

#[test]
#[should_panic(expected = "platform fee")]
fn new_rejects_fee_over_100_percent() {
    as_user("admin");
    BlindMark::new(acct("admin"), acct("outlayer"), acct("treasury"), 10_001);
}

#[test]
#[should_panic(expected = "admin only")]
fn add_backend_rejects_non_admin() {
    let mut contract = new_contract();
    as_user("mallory");
    contract.add_backend(Backend {
        id: "other".to_string(),
        kind: BackendKind::OutLayer,
        measurement: MEASUREMENT.to_string(),
        outlayer_project: Some("a/b".to_string()),
        active: true,
    });
}

#[test]
#[should_panic(expected = "already exists")]
fn backend_measurement_cannot_be_replaced() {
    let mut contract = new_contract();
    as_user("admin");
    contract.add_backend(Backend {
        id: "outlayer-v1".to_string(),
        kind: BackendKind::OutLayer,
        measurement: EVIDENCE.to_string(),
        outlayer_project: Some("a/b".to_string()),
        active: true,
    });
}

#[test]
#[should_panic(expected = "outlayer_project")]
fn outlayer_backend_requires_project() {
    let mut contract = new_contract();
    as_user("admin");
    contract.add_backend(Backend {
        id: "other".to_string(),
        kind: BackendKind::OutLayer,
        measurement: MEASUREMENT.to_string(),
        outlayer_project: None,
        active: true,
    });
}

#[test]
#[should_panic(expected = "measurement")]
fn outlayer_backend_requires_hash_measurement() {
    let mut contract = new_contract();
    as_user("admin");
    contract.add_backend(Backend {
        id: "other".to_string(),
        kind: BackendKind::OutLayer,
        measurement: "repo@commit".to_string(),
        outlayer_project: Some("a/b".to_string()),
        active: true,
    });
}

#[test]
#[should_panic(expected = "admin only")]
fn set_backend_active_rejects_non_admin() {
    let mut contract = new_contract();
    as_user("mallory");
    contract.set_backend_active("outlayer-v1".to_string(), false);
}

#[test]
#[should_panic(expected = "admin only")]
fn add_model_rejects_non_admin() {
    let mut contract = new_contract();
    as_user("mallory");
    contract.add_model(ModelInfo {
        id: "m".to_string(),
        tier: "A".to_string(),
        active: true,
    });
}

#[test]
#[should_panic(expected = "tier")]
fn add_model_rejects_unknown_tier() {
    let mut contract = new_contract();
    as_user("admin");
    contract.add_model(ModelInfo {
        id: "m".to_string(),
        tier: "Z".to_string(),
        active: true,
    });
}

#[test]
fn views_list_backends_and_models() {
    let contract = new_contract();
    assert_eq!(contract.get_backends()[0].id, "outlayer-v1");
    assert_eq!(contract.get_models()[0].id, "model-a");
}

// ---------- register_benchmark ----------

#[test]
fn register_stores_benchmark_and_applies_defaults() {
    let (contract, id) = with_benchmark(4);
    let benchmark = contract.get_benchmark(id).unwrap();
    assert_eq!(benchmark.owner, acct("owner"));
    assert_eq!(benchmark.max_evals_per_model, 3);
    assert_eq!(benchmark.cooldown_ns, U64(24 * HOUR_NS));
    assert_eq!(benchmark.status, BenchmarkStatus::Active);
    assert_eq!(benchmark.created_at_ns, U64(START_NS));
    assert!(has_event("benchmark_registered"));
}

#[test]
fn register_assigns_increasing_ids_and_lists_them() {
    let (mut contract, first) = with_benchmark(1);
    call_env("owner", ONE_NEAR, START_NS, None);
    let second = contract.register_benchmark(benchmark_args(1));
    assert_eq!(second, first + 1);
    assert_eq!(contract.list_benchmarks(0, 10).len(), 2);
    assert_eq!(contract.list_benchmarks(1, 10)[0].id, second);
}

#[test]
fn register_refunds_unused_storage_deposit() {
    let (_contract, _id) = with_benchmark(1);
    let refund = transferred_to("owner");
    assert!(refund > 0 && refund < ONE_NEAR, "refund was {refund}");
}

#[test]
#[should_panic(expected = "storage")]
fn register_rejects_too_little_storage_deposit() {
    let mut contract = new_contract();
    call_env("owner", 1, START_NS, None);
    contract.register_benchmark(benchmark_args(1));
}

fn register_with(change: impl FnOnce(&mut RegisterBenchmarkArgs)) {
    let mut contract = new_contract();
    let mut args = benchmark_args(2);
    change(&mut args);
    call_env("owner", ONE_NEAR, START_NS, None);
    contract.register_benchmark(args);
}

#[test]
#[should_panic(expected = "same length")]
fn register_rejects_mismatched_lists() {
    register_with(|a| {
        a.shard_uris.pop();
    });
}

#[test]
#[should_panic(expected = "dataset_root")]
fn register_rejects_wrong_root() {
    register_with(|a| a.dataset_root = EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "shard")]
fn register_rejects_no_shards() {
    let mut contract = new_contract();
    call_env("owner", ONE_NEAR, START_NS, None);
    contract.register_benchmark(benchmark_args(0));
}

#[test]
#[should_panic(expected = "shard")]
fn register_rejects_too_many_shards() {
    let mut contract = new_contract();
    call_env("owner", ONE_NEAR, START_NS, None);
    contract.register_benchmark(benchmark_args(MAX_SHARDS + 1));
}

#[test]
fn register_accepts_the_shard_cap() {
    let mut contract = new_contract();
    call_env("owner", ONE_NEAR, START_NS, None);
    contract.register_benchmark(benchmark_args(MAX_SHARDS));
}

#[test]
#[should_panic(expected = "price")]
fn register_rejects_zero_price() {
    register_with(|a| a.price = U128(0));
}

#[test]
#[should_panic(expected = "item_count")]
fn register_rejects_zero_items() {
    register_with(|a| a.item_count = 0);
}

#[test]
#[should_panic(expected = "protocol_hash")]
fn register_rejects_malformed_protocol_hash() {
    register_with(|a| a.protocol_hash = "XYZ".to_string());
}

#[test]
fn retire_stops_new_evals_only() {
    let (mut contract, eval_id) = with_eval(1);
    as_user("owner");
    contract.retire_benchmark(0);
    assert_eq!(
        contract.get_benchmark(0).unwrap().status,
        BenchmarkStatus::Retired
    );
    deliver_shard(&mut contract, eval_id, 0);
    assert!(contract.get_eval(eval_id).unwrap().partials[0].is_some());
}

#[test]
#[should_panic(expected = "owner only")]
fn retire_rejects_non_owner() {
    let (mut contract, id) = with_benchmark(1);
    as_user("mallory");
    contract.retire_benchmark(id);
}

// ---------- request_eval ----------

#[test]
fn request_creates_eval_with_budget_and_deadline() {
    let (contract, eval_id) = with_eval(5);
    let eval = contract.get_eval(eval_id).unwrap();
    assert_eq!(eval.requester, acct("requester"));
    assert_eq!(eval.fee, U128(PRICE));
    assert_eq!(eval.compute_budget, U128(9 * COMPUTE_PER_RUN));
    assert_eq!(eval.retries_left, MAX_RETRIES);
    assert_eq!(eval.deadline_ns, U64(START_NS + EVAL_DEADLINE_NS));
    assert_eq!(eval.partials.len(), 5);
    assert_eq!(eval.nonce, hex::encode([7u8; 32]));
    assert!(has_event("eval_requested"));
}

#[test]
fn request_dispatches_first_batch_only() {
    let (contract, eval_id) = with_eval(5);
    assert_eq!(execution_calls().len(), MAX_DISPATCH_PER_TX as usize);
    let eval = contract.get_eval(eval_id).unwrap();
    assert_eq!(eval.status, EvalStatus::Dispatching);
    assert_eq!(eval.next_shard_to_dispatch, MAX_DISPATCH_PER_TX);
    assert_eq!(eval.compute_spent, U128(3 * COMPUTE_PER_RUN));
}

#[test]
fn request_moves_to_grading_when_all_shards_fit_in_first_batch() {
    let (contract, eval_id) = with_eval(2);
    assert_eq!(execution_calls().len(), 2);
    assert_eq!(status(&contract, eval_id), EvalStatus::Grading);
}

#[test]
fn grade_run_is_pinned_and_shaped_as_outlayer_requires() {
    let (_contract, eval_id) = with_eval(2);
    let calls = execution_calls();
    let call = &calls[0];
    assert_eq!(call.receiver, acct("outlayer"));
    assert_eq!(call.deposit, COMPUTE_PER_RUN);
    assert_eq!(call.gas, 60);
    assert_eq!(
        call.args["source"],
        json!({ "Project": { "project_id": "grader.testnet/grader", "version_key": MEASUREMENT } })
    );
    assert!(call.args["resource_limits"]["max_instructions"].is_u64());
    assert_eq!(call.args["response_format"], "Json");
    assert_eq!(call.args["payer_account_id"], "requester.testnet");
    assert_eq!(
        call.args["secrets_ref"],
        json!({ "profile": "math-k", "account_id": "owner.testnet" })
    );
    let input = input_of(call);
    assert_eq!(input["mode"], "grade");
    assert_eq!(input["eval_id"], eval_id);
    assert_eq!(input["shard_index"], 0);
    assert_eq!(input["model_id"], "model-a");
    assert_eq!(input["shard_hash"], hashes(2)[0]);
    assert_eq!(input["merkle_proof"][0]["hash"], hashes(2)[1]);
    assert_eq!(input["merkle_proof"][0]["side"], "R");
}

#[test]
fn grade_run_has_callback_to_on_shard_graded() {
    let (_contract, eval_id) = with_eval(1);
    let calls = function_calls();
    let callback = calls
        .iter()
        .find(|c| c.method == "on_shard_graded")
        .unwrap();
    assert_eq!(callback.receiver, acct("blindmark"));
    assert_eq!(
        callback.args,
        json!({ "eval_id": eval_id, "shard_index": 0 })
    );
    assert!(callback.gas >= 10);
}

#[test]
fn request_refunds_excess_deposit_at_once() {
    let (mut contract, id) = with_benchmark(1);
    let deposit = required_deposit(&contract, 1) + 123;
    call_env("requester", deposit, START_NS, None);
    contract.request_eval(id, "model-a".to_string(), "outlayer-v1".to_string());
    assert_eq!(transferred_to("requester"), 123);
}

#[test]
#[should_panic(expected = "deposit")]
fn request_rejects_too_little_deposit() {
    let (mut contract, id) = with_benchmark(1);
    let deposit = required_deposit(&contract, 1) - 1;
    call_env("requester", deposit, START_NS, None);
    contract.request_eval(id, "model-a".to_string(), "outlayer-v1".to_string());
}

#[test]
#[should_panic(expected = "not active")]
fn request_rejects_retired_benchmark() {
    let (mut contract, id) = with_benchmark(1);
    as_user("owner");
    contract.retire_benchmark(id);
    call_env("requester", 10 * ONE_NEAR, START_NS, None);
    contract.request_eval(id, "model-a".to_string(), "outlayer-v1".to_string());
}

#[test]
#[should_panic(expected = "model")]
fn request_rejects_inactive_model() {
    let (mut contract, id) = with_benchmark(1);
    as_user("admin");
    contract.set_model_active("model-a".to_string(), false);
    call_env("requester", 10 * ONE_NEAR, START_NS, None);
    contract.request_eval(id, "model-a".to_string(), "outlayer-v1".to_string());
}

#[test]
#[should_panic(expected = "model")]
fn request_rejects_unknown_model() {
    let (mut contract, id) = with_benchmark(1);
    call_env("requester", 10 * ONE_NEAR, START_NS, None);
    contract.request_eval(id, "nope".to_string(), "outlayer-v1".to_string());
}

#[test]
#[should_panic(expected = "backend")]
fn request_rejects_inactive_backend() {
    let (mut contract, id) = with_benchmark(1);
    as_user("admin");
    contract.set_backend_active("outlayer-v1".to_string(), false);
    call_env("requester", 10 * ONE_NEAR, START_NS, None);
    contract.request_eval(id, "model-a".to_string(), "outlayer-v1".to_string());
}

#[test]
#[should_panic(expected = "ShadeDstack")]
fn request_rejects_shade_backend_until_part_2() {
    let (mut contract, id) = with_benchmark(1);
    as_user("admin");
    contract.add_backend(Backend {
        id: "shade".to_string(),
        kind: BackendKind::ShadeDstack,
        measurement: "sha256:abc".to_string(),
        outlayer_project: None,
        active: true,
    });
    call_env("requester", 10 * ONE_NEAR, START_NS, None);
    contract.request_eval(id, "model-a".to_string(), "shade".to_string());
}

#[test]
#[should_panic(expected = "cooldown")]
fn request_enforces_cooldown() {
    let (mut contract, eval_id) = with_eval(1);
    let deposit = required_deposit(&contract, 1);
    call_env("requester", deposit, START_NS + 23 * HOUR_NS, None);
    let _ = eval_id;
    contract.request_eval(0, "model-a".to_string(), "outlayer-v1".to_string());
}

#[test]
fn request_allows_after_cooldown_and_counts_usage() {
    let (mut contract, _eval_id) = with_eval(1);
    let deposit = required_deposit(&contract, 1);
    call_env("requester", deposit, START_NS + 24 * HOUR_NS, None);
    contract.request_eval(0, "model-a".to_string(), "outlayer-v1".to_string());
    let usage = contract.get_usage(0, "model-a".to_string()).unwrap();
    assert_eq!(usage.count, 2);
    assert_eq!(usage.last_requested_ns, U64(START_NS + 24 * HOUR_NS));
}

#[test]
#[should_panic(expected = "limit")]
fn request_enforces_eval_count_limit() {
    let (mut contract, _eval_id) = with_eval(1);
    let deposit = required_deposit(&contract, 1);
    for day in 1..=3u64 {
        call_env("requester", deposit, START_NS + day * 24 * HOUR_NS, None);
        contract.request_eval(0, "model-a".to_string(), "outlayer-v1".to_string());
    }
}

#[test]
fn eval_storage_deposit_scales_with_shards() {
    let contract = new_contract();
    assert!(contract.eval_storage_deposit(64).0 > contract.eval_storage_deposit(1).0);
}

// ---------- continue_dispatch ----------

#[test]
fn continue_sends_next_batch_then_moves_to_grading() {
    let (mut contract, eval_id) = with_eval(5);
    as_user("anyone");
    contract.continue_dispatch(eval_id);
    let calls = execution_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(input_of(&calls[0])["shard_index"], 3);
    assert_eq!(input_of(&calls[1])["shard_index"], 4);
    let eval = contract.get_eval(eval_id).unwrap();
    assert_eq!(eval.status, EvalStatus::Grading);
    assert_eq!(eval.compute_spent, U128(5 * COMPUTE_PER_RUN));
}

#[test]
#[should_panic(expected = "deadline")]
fn continue_rejects_after_deadline() {
    let (mut contract, eval_id) = with_eval(5);
    call_env("anyone", 0, START_NS + EVAL_DEADLINE_NS + 1, None);
    contract.continue_dispatch(eval_id);
}

#[test]
#[should_panic(expected = "nothing to dispatch")]
fn continue_rejects_while_results_are_outstanding() {
    let (mut contract, eval_id) = with_eval(2);
    deliver_shard(&mut contract, eval_id, 0);
    as_user("anyone");
    contract.continue_dispatch(eval_id);
}

#[test]
fn continue_starts_aggregation_once_all_shards_are_graded() {
    let (contract, eval_id) = to_aggregating(2);
    let eval = contract.get_eval(eval_id).unwrap();
    assert_eq!(eval.status, EvalStatus::Aggregating);
    assert_eq!(eval.compute_spent, U128(3 * COMPUTE_PER_RUN));
    let calls = execution_calls();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert_eq!(
        call.args["source"]["Project"]["version_key"], MEASUREMENT,
        "aggregation must be pinned too"
    );
    assert!(
        call.args["secrets_ref"].is_null(),
        "aggregation does not need K"
    );
    let input = input_of(call);
    assert_eq!(input["mode"], "aggregate");
    assert_eq!(input["expected_shards"], 2);
    assert_eq!(input["n_items_expected"], 500);
    assert_eq!(
        input["sealed_partials"],
        json!([
            { "shard_index": 0, "sealed": "sealed-0" },
            { "shard_index": 1, "sealed": "sealed-1" }
        ])
    );
    let callback = function_calls()
        .into_iter()
        .find(|c| c.method == "on_aggregated");
    assert!(callback.unwrap().gas >= 20);
}

#[test]
#[should_panic(expected = "nothing to dispatch")]
fn aggregation_cannot_start_twice() {
    let (mut contract, eval_id) = to_aggregating(1);
    as_user("anyone");
    contract.continue_dispatch(eval_id);
}

// ---------- on_shard_graded ----------

fn deliver_raw(contract: &mut BlindMark, eval_id: u64, shard: u32, result: Option<PromiseResult>) {
    call_env("blindmark", 0, START_NS, result);
    contract.on_shard_graded(eval_id, shard);
}

#[test]
fn shard_result_is_stored() {
    let (mut contract, eval_id) = with_eval(2);
    deliver_shard(&mut contract, eval_id, 1);
    let eval = contract.get_eval(eval_id).unwrap();
    assert_eq!(eval.partials[1].as_deref(), Some("sealed-1"));
    assert_eq!(eval.evidence_hashes[1].as_deref(), Some(EVIDENCE));
    assert!(eval.partials[0].is_none());
    assert!(has_event("shard_graded"));
}

fn assert_shard_rejected(change: impl FnOnce(&mut GradeResult)) {
    let (mut contract, eval_id) = with_eval(2);
    let mut result = grade_result(eval_id, 0);
    change(&mut result);
    deliver_raw(&mut contract, eval_id, 0, success(&result));
    assert_eq!(status(&contract, eval_id), EvalStatus::Failed);
    assert!(contract.get_eval(eval_id).unwrap().partials[0].is_none());
}

#[test]
fn shard_rejects_wrong_eval_id() {
    assert_shard_rejected(|r| r.eval_id = 99);
}

#[test]
fn shard_rejects_wrong_index() {
    assert_shard_rejected(|r| r.shard_index = 1);
}

#[test]
fn shard_rejects_wrong_hash() {
    assert_shard_rejected(|r| r.shard_hash = EVIDENCE.to_string());
}

#[test]
fn shard_rejects_not_ok() {
    assert_shard_rejected(|r| {
        r.ok = false;
        r.error = Some("decrypt".to_string());
    });
}

#[test]
fn shard_rejects_malformed_evidence_hash() {
    assert_shard_rejected(|r| r.evidence_hash = "nope".to_string());
}

#[test]
fn shard_rejects_empty_sealed_partial() {
    assert_shard_rejected(|r| r.sealed_partial = String::new());
}

#[test]
fn shard_rejects_malformed_json() {
    let (mut contract, eval_id) = with_eval(2);
    let raw = Some(PromiseResult::Successful(br#"{"not":"a result"}"#.to_vec()));
    deliver_raw(&mut contract, eval_id, 0, raw);
    assert_eq!(status(&contract, eval_id), EvalStatus::Failed);
}

#[test]
fn shard_rejects_result_over_900_bytes() {
    let (mut contract, eval_id) = with_eval(2);
    let mut result = grade_result(eval_id, 0);
    result.sealed_partial = "a".repeat(900);
    deliver_raw(&mut contract, eval_id, 0, success(&result));
    assert_eq!(status(&contract, eval_id), EvalStatus::Failed);
}

#[test]
fn failed_promise_fails_the_eval() {
    let (mut contract, eval_id) = with_eval(2);
    deliver_raw(&mut contract, eval_id, 0, Some(PromiseResult::Failed));
    assert_eq!(status(&contract, eval_id), EvalStatus::Failed);
}

#[test]
fn null_result_queues_a_retry() {
    let (mut contract, eval_id) = with_eval(2);
    deliver_raw(&mut contract, eval_id, 1, null_result());
    let eval = contract.get_eval(eval_id).unwrap();
    assert_eq!(eval.status, EvalStatus::Grading);
    assert_eq!(eval.retries_left, MAX_RETRIES - 1);
    assert_eq!(eval.retry_shards, vec![1]);
}

#[test]
fn null_with_no_retries_left_fails_the_eval() {
    let (mut contract, eval_id) = with_eval(1);
    for _ in 0..MAX_RETRIES {
        deliver_raw(&mut contract, eval_id, 0, null_result());
        as_user("anyone");
        contract.continue_dispatch(eval_id);
    }
    assert_eq!(status(&contract, eval_id), EvalStatus::Grading);
    deliver_raw(&mut contract, eval_id, 0, null_result());
    assert_eq!(status(&contract, eval_id), EvalStatus::Failed);
}

#[test]
fn continue_resends_retries_before_new_shards() {
    let (mut contract, eval_id) = with_eval(5);
    deliver_raw(&mut contract, eval_id, 1, null_result());
    as_user("anyone");
    contract.continue_dispatch(eval_id);
    let calls = execution_calls();
    let shards: Vec<u64> = calls
        .iter()
        .map(|c| input_of(c)["shard_index"].as_u64().unwrap())
        .collect();
    assert_eq!(shards, vec![1, 3, 4]);
    let eval = contract.get_eval(eval_id).unwrap();
    assert!(eval.retry_shards.is_empty());
    assert_eq!(eval.compute_spent, U128(6 * COMPUTE_PER_RUN));
}

#[test]
fn retried_shard_can_then_complete() {
    let (mut contract, eval_id) = with_eval(1);
    deliver_raw(&mut contract, eval_id, 0, null_result());
    as_user("anyone");
    contract.continue_dispatch(eval_id);
    deliver_shard(&mut contract, eval_id, 0);
    as_user("anyone");
    contract.continue_dispatch(eval_id);
    assert_eq!(status(&contract, eval_id), EvalStatus::Aggregating);
}

#[test]
#[should_panic(expected = "nothing to dispatch")]
fn aggregation_waits_for_a_queued_retry() {
    let (mut contract, eval_id) = with_eval(2);
    deliver_shard(&mut contract, eval_id, 0);
    deliver_raw(&mut contract, eval_id, 1, null_result());
    as_user("anyone");
    contract.continue_dispatch(eval_id);
    as_user("anyone");
    contract.continue_dispatch(eval_id);
}

#[test]
fn duplicate_shard_result_is_ignored() {
    let (mut contract, eval_id) = with_eval(2);
    deliver_shard(&mut contract, eval_id, 0);
    let mut second = grade_result(eval_id, 0);
    second.sealed_partial = "replacement".to_string();
    deliver_raw(&mut contract, eval_id, 0, success(&second));
    assert_eq!(
        contract.get_eval(eval_id).unwrap().partials[0].as_deref(),
        Some("sealed-0")
    );
}

#[test]
fn shard_callback_for_unknown_eval_is_ignored() {
    let (mut contract, _eval_id) = with_eval(1);
    deliver_raw(&mut contract, 99, 0, null_result());
    assert!(contract.get_eval(99).is_none());
}

#[test]
fn shard_callback_for_out_of_range_index_fails_the_eval() {
    let (mut contract, eval_id) = with_eval(1);
    deliver_raw(&mut contract, eval_id, 7, null_result());
    assert_eq!(status(&contract, eval_id), EvalStatus::Failed);
}

// ---------- on_aggregated ----------

#[test]
fn certificate_records_the_result_and_commitments() {
    let (contract, eval_id) = certified(2);
    assert_eq!(status(&contract, eval_id), EvalStatus::Certified);
    let cert = contract.get_certificate(eval_id).unwrap();
    let benchmark = contract.get_benchmark(0).unwrap();
    assert_eq!(cert.benchmark_id, 0);
    assert_eq!(cert.benchmark_version, 1);
    assert_eq!(cert.dataset_root, benchmark.dataset_root);
    assert_eq!(cert.protocol_hash, PROTOCOL_HASH);
    assert_eq!(cert.model_id, "model-a");
    assert_eq!(cert.trust_tier, "A");
    assert_eq!(cert.backend_id, "outlayer-v1");
    assert_eq!(cert.grader_measurement, MEASUREMENT);
    assert_eq!(
        (cert.n_items, cert.n_correct, cert.score_bps),
        (500, 361, 7220)
    );
    assert_eq!((cert.ci_low_bps, cert.ci_high_bps), (6812, 7595));
    assert_eq!(cert.mean_latency_ms, 1840);
    assert_eq!(
        cert.evidence_hashes,
        vec![EVIDENCE.to_string(), EVIDENCE.to_string()]
    );
    assert!(has_event("eval_certified"));
}

#[test]
fn certification_pays_treasury_fee_and_owner_remainder() {
    let (_contract, _eval_id) = certified(2);
    let fee = PRICE * 500 / 10_000;
    assert_eq!(transferred_to("treasury"), fee);
    assert_eq!(transferred_to("owner"), PRICE - fee);
}

#[test]
fn certification_rounds_fee_down_with_no_dust_lost() {
    let mut contract = new_contract();
    let mut args = benchmark_args(1);
    args.price = U128(10_001);
    call_env("owner", ONE_NEAR, START_NS, None);
    contract.register_benchmark(args);
    let deposit = 10_001 + 5 * COMPUTE_PER_RUN + contract.eval_storage_deposit(1).0;
    call_env("requester", deposit, START_NS, None);
    let eval_id = contract.request_eval(0, "model-a".to_string(), "outlayer-v1".to_string());
    deliver_shard(&mut contract, eval_id, 0);
    as_user("anyone");
    contract.continue_dispatch(eval_id);
    call_env(
        "blindmark",
        0,
        START_NS,
        success(&aggregate_result(eval_id)),
    );
    contract.on_aggregated(eval_id);
    assert_eq!(transferred_to("treasury"), 500);
    assert_eq!(transferred_to("owner"), 9_501);
}

#[test]
fn certification_returns_unused_retry_budget_to_requester() {
    let (_contract, _eval_id) = certified(2);
    assert_eq!(
        transferred_to("requester"),
        MAX_RETRIES as u128 * COMPUTE_PER_RUN
    );
}

#[test]
fn certificates_are_listed_by_benchmark() {
    let (contract, eval_id) = certified(1);
    let listed = contract.list_certificates(0, 0, 10);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].eval_id, eval_id);
    assert!(contract.list_certificates(0, 1, 10).is_empty());
    assert!(contract.list_certificates(5, 0, 10).is_empty());
}

fn assert_aggregate_rejected(change: impl FnOnce(&mut AggregateResult)) {
    let (mut contract, eval_id) = to_aggregating(1);
    let mut result = aggregate_result(eval_id);
    change(&mut result);
    call_env("blindmark", 0, START_NS, success(&result));
    contract.on_aggregated(eval_id);
    assert_eq!(status(&contract, eval_id), EvalStatus::Failed);
    assert!(contract.get_certificate(eval_id).is_none());
    assert!(transfers().is_empty(), "no money may move on a rejection");
}

#[test]
fn aggregate_rejects_wrong_eval_id() {
    assert_aggregate_rejected(|r| r.eval_id = 99);
}

#[test]
fn aggregate_rejects_wrong_item_count() {
    assert_aggregate_rejected(|r| r.n_items = 499);
}

#[test]
fn aggregate_rejects_not_ok() {
    assert_aggregate_rejected(|r| r.ok = false);
}

#[test]
fn aggregate_rejects_more_correct_than_items() {
    assert_aggregate_rejected(|r| r.n_correct = 501);
}

#[test]
fn aggregate_rejects_failed_promise() {
    let (mut contract, eval_id) = to_aggregating(1);
    call_env("blindmark", 0, START_NS, Some(PromiseResult::Failed));
    contract.on_aggregated(eval_id);
    assert_eq!(status(&contract, eval_id), EvalStatus::Failed);
}

#[test]
fn aggregate_null_returns_to_grading_so_it_can_be_resent() {
    let (mut contract, eval_id) = to_aggregating(1);
    call_env("blindmark", 0, START_NS, null_result());
    contract.on_aggregated(eval_id);
    let eval = contract.get_eval(eval_id).unwrap();
    assert_eq!(eval.status, EvalStatus::Grading);
    assert_eq!(eval.retries_left, MAX_RETRIES - 1);
    as_user("anyone");
    contract.continue_dispatch(eval_id);
    assert_eq!(status(&contract, eval_id), EvalStatus::Aggregating);
    assert_eq!(execution_calls().len(), 1);
}

#[test]
fn aggregate_null_with_no_retries_left_fails_the_eval() {
    let (mut contract, eval_id) = to_aggregating(1);
    for _ in 0..MAX_RETRIES {
        call_env("blindmark", 0, START_NS, null_result());
        contract.on_aggregated(eval_id);
        as_user("anyone");
        contract.continue_dispatch(eval_id);
    }
    call_env("blindmark", 0, START_NS, null_result());
    contract.on_aggregated(eval_id);
    assert_eq!(status(&contract, eval_id), EvalStatus::Failed);
}

#[test]
fn duplicate_aggregate_result_pays_only_once() {
    let (mut contract, eval_id) = certified(1);
    call_env(
        "blindmark",
        0,
        START_NS,
        success(&aggregate_result(eval_id)),
    );
    contract.on_aggregated(eval_id);
    assert!(transfers().is_empty());
}

// ---------- refund_expired ----------

#[test]
#[should_panic(expected = "not refundable")]
fn refund_rejected_before_deadline() {
    let (mut contract, eval_id) = with_eval(1);
    as_user("anyone");
    contract.refund_expired(eval_id);
}

#[test]
fn refund_after_deadline_returns_price_and_undispatched_budget() {
    let (mut contract, eval_id) = with_eval(5);
    call_env("anyone", 0, START_NS + EVAL_DEADLINE_NS + 1, None);
    contract.refund_expired(eval_id);
    assert_eq!(status(&contract, eval_id), EvalStatus::Refunded);
    // 3 runs were sent; 6 of the 9 budgeted runs were never dispatched.
    assert_eq!(transferred_to("requester"), PRICE + 6 * COMPUTE_PER_RUN);
    assert!(has_event("eval_refunded"));
}

#[test]
fn failed_eval_can_be_refunded_at_once() {
    let (mut contract, eval_id) = with_eval(1);
    deliver_raw(&mut contract, eval_id, 0, Some(PromiseResult::Failed));
    as_user("anyone");
    contract.refund_expired(eval_id);
    assert_eq!(status(&contract, eval_id), EvalStatus::Refunded);
    assert!(transferred_to("requester") > PRICE);
}

#[test]
#[should_panic(expected = "not refundable")]
fn second_refund_is_rejected() {
    let (mut contract, eval_id) = with_eval(1);
    call_env("anyone", 0, START_NS + EVAL_DEADLINE_NS + 1, None);
    contract.refund_expired(eval_id);
    call_env("anyone", 0, START_NS + EVAL_DEADLINE_NS + 2, None);
    contract.refund_expired(eval_id);
}

#[test]
#[should_panic(expected = "not refundable")]
fn certified_eval_cannot_be_refunded() {
    let (mut contract, eval_id) = certified(1);
    call_env("anyone", 0, START_NS + EVAL_DEADLINE_NS + 1, None);
    contract.refund_expired(eval_id);
}

#[test]
fn late_shard_result_after_refund_is_ignored() {
    let (mut contract, eval_id) = with_eval(1);
    call_env("anyone", 0, START_NS + EVAL_DEADLINE_NS + 1, None);
    contract.refund_expired(eval_id);
    deliver_shard(&mut contract, eval_id, 0);
    let eval = contract.get_eval(eval_id).unwrap();
    assert_eq!(eval.status, EvalStatus::Refunded);
    assert!(eval.partials[0].is_none());
}

#[test]
fn late_aggregate_after_refund_pays_nothing() {
    let (mut contract, eval_id) = to_aggregating(1);
    call_env("anyone", 0, START_NS + EVAL_DEADLINE_NS + 1, None);
    contract.refund_expired(eval_id);
    call_env(
        "blindmark",
        0,
        START_NS + EVAL_DEADLINE_NS + 2,
        success(&aggregate_result(eval_id)),
    );
    contract.on_aggregated(eval_id);
    assert_eq!(status(&contract, eval_id), EvalStatus::Refunded);
    assert!(contract.get_certificate(eval_id).is_none());
    assert!(transfers().is_empty());
}

#[test]
fn refund_gives_back_an_attempt_but_not_the_cooldown() {
    let (mut contract, eval_id) = with_eval(1);
    call_env("anyone", 0, START_NS + EVAL_DEADLINE_NS + 1, None);
    contract.refund_expired(eval_id);
    let usage = contract.get_usage(0, "model-a".to_string()).unwrap();
    assert_eq!(usage.count, 0);
    assert_eq!(usage.last_requested_ns, U64(START_NS));
}

#[test]
#[should_panic(expected = "not found")]
fn refund_of_unknown_eval_panics() {
    let (mut contract, _eval_id) = with_eval(1);
    as_user("anyone");
    contract.refund_expired(99);
}

// ---------- storage ----------

/// Measures the storage one full eval and certificate really use, at the largest allowed sizes.
fn storage_used_by_certified_eval(shard_count: usize) -> (u64, u128) {
    let (mut contract, benchmark_id) = with_benchmark(shard_count);
    contract.flush_for_test();
    let before = near_sdk::env::storage_usage();
    let deposit = required_deposit(&contract, shard_count as u32);
    call_env("requester", deposit, START_NS, None);
    let eval_id = contract.request_eval(
        benchmark_id,
        "model-a".to_string(),
        "outlayer-v1".to_string(),
    );
    keep_dispatching(&mut contract, eval_id);
    for (i, shard_hash) in hashes(shard_count).into_iter().enumerate() {
        let mut result = grade_result(eval_id, i as u32);
        result.shard_hash = shard_hash;
        // The largest sealed partial that keeps the whole result within 900 bytes.
        let base = serde_json::to_vec(&result).unwrap().len() - result.sealed_partial.len();
        result.sealed_partial = "a".repeat(900 - base);
        call_env("blindmark", 0, START_NS, success(&result));
        contract.on_shard_graded(eval_id, i as u32);
    }
    as_user("anyone");
    contract.continue_dispatch(eval_id);
    call_env(
        "blindmark",
        0,
        START_NS,
        success(&aggregate_result(eval_id)),
    );
    contract.on_aggregated(eval_id);
    assert_eq!(status(&contract, eval_id), EvalStatus::Certified);
    contract.flush_for_test();
    let used = near_sdk::env::storage_usage() - before;
    (used, contract.eval_storage_deposit(shard_count as u32).0)
}

#[test]
fn storage_deposit_covers_real_storage_at_one_shard() {
    let (used, deposit) = storage_used_by_certified_eval(1);
    let cost = used as u128 * near_sdk::env::storage_byte_cost().as_yoctonear();
    assert!(
        deposit >= cost,
        "deposit {deposit} below cost {cost} for {used} bytes"
    );
}

#[test]
fn storage_deposit_covers_real_storage_at_the_shard_cap() {
    let (used, deposit) = storage_used_by_certified_eval(MAX_SHARDS);
    let cost = used as u128 * near_sdk::env::storage_byte_cost().as_yoctonear();
    assert!(
        deposit >= cost,
        "deposit {deposit} below cost {cost} for {used} bytes"
    );
}
