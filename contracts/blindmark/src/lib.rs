//! BlindMark NEAR contract. Spec: CLAUDE.md section 7.
//!
//! Money rules (section 7.5): the price leaves escrow once, on `Certified` (owner and treasury)
//! or `Refunded` (requester). Each run's compute is attached to OutLayer, which refunds the unused
//! part straight to the requester. This contract never sees grader plaintext; it only stores
//! sealed partials and hashes.

mod types;

#[cfg(test)]
mod tests;

pub use types::*;

use blindmark_types::merkle::{self, Hash};
use blindmark_types::wire::{
    AggregateRequest, AggregateResult, GradeRequest, GradeResult, MAX_RESULT_BYTES,
    SealedPartialEntry,
};
use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{self, Value, json};
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, env, near, require,
};

/// Runs per transaction. Measured in spike S6: 3 leave a 27% gas margin.
pub const MAX_DISPATCH_PER_TX: u32 = 3;
/// Extra runs per eval when OutLayer returns no result.
pub const MAX_RETRIES: u32 = 3;
pub const MAX_SHARDS: usize = 64;
/// 0.02 NEAR. Covers OutLayer's estimate at the limits in `resource_limits`.
pub const COMPUTE_PER_RUN: u128 = 20_000_000_000_000_000_000_000;
pub const EVAL_DEADLINE_NS: u64 = 6 * 60 * 60 * 1_000_000_000;
const DEFAULT_COOLDOWN_NS: u64 = 24 * 60 * 60 * 1_000_000_000;
const DEFAULT_MAX_EVALS_PER_MODEL: u32 = 3;
const MAX_FEE_BPS: u16 = 10_000;
const MAX_ID_LEN: usize = 128;

/// 60 Tgas worked in S6 with a 20 KB input; 52 Tgas ran out.
const REQUEST_GAS: Gas = Gas::from_tgas(60);
const SHARD_CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// Writes the certificate and sends up to three transfers.
const AGGREGATE_CALLBACK_GAS: Gas = Gas::from_tgas(20);

/// Storage charged per eval and certificate. Unit tests measured 987 bytes for 1 shard and
/// 43,656 for 64 with the largest results (about 680 per shard). The headroom covers longer ids.
const EVAL_STORAGE_BASE_BYTES: u64 = 1_500;
const EVAL_STORAGE_PER_SHARD_BYTES: u64 = 750;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Backends,
    Models,
    Benchmarks,
    Evals,
    Certificates,
    CertIndex,
    CertIndexInner { benchmark_id: u64 },
    Usage,
}

#[near(event_json(standard = "blindmark"))]
pub enum Event {
    #[event_version("1.0.0")]
    BenchmarkRegistered { benchmark_id: u64, owner: AccountId },
    #[event_version("1.0.0")]
    EvalRequested {
        eval_id: u64,
        benchmark_id: u64,
        model_id: String,
        requester: AccountId,
    },
    #[event_version("1.0.0")]
    ShardGraded { eval_id: u64, shard_index: u32 },
    #[event_version("1.0.0")]
    EvalCertified {
        eval_id: u64,
        benchmark_id: u64,
        model_id: String,
        score_bps: u32,
    },
    #[event_version("1.0.0")]
    EvalRefunded { eval_id: u64, amount: U128 },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct BlindMark {
    admin: AccountId,
    outlayer_contract: AccountId,
    platform_fee_bps: u16,
    treasury: AccountId,
    next_benchmark_id: u64,
    next_eval_id: u64,
    backends: IterableMap<String, Backend>,
    models: IterableMap<String, ModelInfo>,
    benchmarks: IterableMap<u64, Benchmark>,
    evals: LookupMap<u64, Eval>,
    certificates: LookupMap<u64, Certificate>,
    cert_index: LookupMap<u64, Vector<u64>>,
    usage: LookupMap<(u64, String), Usage>,
}

#[near]
impl BlindMark {
    #[init]
    pub fn new(
        admin: AccountId,
        outlayer_contract: AccountId,
        treasury: AccountId,
        platform_fee_bps: u16,
    ) -> Self {
        require!(
            platform_fee_bps <= MAX_FEE_BPS,
            "platform fee must be at most 10000 bps"
        );
        Self {
            admin,
            outlayer_contract,
            platform_fee_bps,
            treasury,
            next_benchmark_id: 0,
            next_eval_id: 0,
            backends: IterableMap::new(StorageKey::Backends),
            models: IterableMap::new(StorageKey::Models),
            benchmarks: IterableMap::new(StorageKey::Benchmarks),
            evals: LookupMap::new(StorageKey::Evals),
            certificates: LookupMap::new(StorageKey::Certificates),
            cert_index: LookupMap::new(StorageKey::CertIndex),
            usage: LookupMap::new(StorageKey::Usage),
        }
    }

    // ---------- admin ----------

    pub fn add_backend(&mut self, backend: Backend) {
        self.assert_admin();
        require!(
            !backend.id.is_empty() && backend.id.len() <= MAX_ID_LEN,
            "backend id length"
        );
        require!(
            !self.backends.contains_key(&backend.id),
            "backend already exists; measurements are immutable"
        );
        if backend.kind == BackendKind::OutLayer {
            require!(
                backend.outlayer_project.is_some(),
                "an OutLayer backend needs outlayer_project"
            );
            require!(
                merkle::parse_hash(&backend.measurement).is_some(),
                "an OutLayer measurement must be the WASM sha256 as 64 lowercase hex characters"
            );
        }
        self.backends.insert(backend.id.clone(), backend);
    }

    pub fn set_backend_active(&mut self, id: String, active: bool) {
        self.assert_admin();
        match self.backends.get_mut(&id) {
            Some(backend) => backend.active = active,
            None => env::panic_str("backend not found"),
        }
    }

    pub fn add_model(&mut self, model: ModelInfo) {
        self.assert_admin();
        require!(
            !model.id.is_empty() && model.id.len() <= MAX_ID_LEN,
            "model id length"
        );
        require!(
            matches!(model.tier.as_str(), "A" | "B" | "C"),
            "tier must be A, B or C"
        );
        require!(!self.models.contains_key(&model.id), "model already exists");
        self.models.insert(model.id.clone(), model);
    }

    pub fn set_model_active(&mut self, id: String, active: bool) {
        self.assert_admin();
        match self.models.get_mut(&id) {
            Some(model) => model.active = active,
            None => env::panic_str("model not found"),
        }
    }

    // ---------- benchmark owner ----------

    #[payable]
    pub fn register_benchmark(&mut self, args: RegisterBenchmarkArgs) -> u64 {
        let shard_count = args.shard_hashes.len();
        require!(
            (1..=MAX_SHARDS).contains(&shard_count),
            "a benchmark needs 1 to 64 shards"
        );
        require!(
            args.shard_uris.len() == shard_count,
            "shard_uris and shard_hashes must have the same length"
        );
        require!(args.price.0 > 0, "price must be above zero");
        require!(args.item_count > 0, "item_count must be above zero");
        require!(
            merkle::parse_hash(&args.protocol_hash).is_some(),
            "protocol_hash must be 64 lowercase hex characters"
        );
        let leaves: Vec<Hash> = args
            .shard_hashes
            .iter()
            .map(|h| {
                merkle::parse_hash(h).unwrap_or_else(|| {
                    env::panic_str("each shard hash must be 64 lowercase hex characters")
                })
            })
            .collect();
        let computed_root = merkle::root(&leaves).map(hex::encode);
        require!(
            computed_root.as_deref() == Some(args.dataset_root.as_str()),
            "dataset_root does not match shard_hashes"
        );

        let storage_before = env::storage_usage();
        let id = self.next_benchmark_id;
        self.next_benchmark_id += 1;
        let owner = env::predecessor_account_id();
        self.benchmarks.insert(
            id,
            Benchmark {
                id,
                version: args.version,
                owner: owner.clone(),
                title: args.title,
                description: args.description,
                grading_type: args.grading_type,
                dataset_root: args.dataset_root,
                protocol_hash: args.protocol_hash,
                protocol_uri: args.protocol_uri,
                shard_uris: args.shard_uris,
                shard_hashes: args.shard_hashes,
                item_count: args.item_count,
                sample_items_uri: args.sample_items_uri,
                price: args.price,
                secret_ref: args.secret_ref,
                max_evals_per_model: args
                    .max_evals_per_model
                    .unwrap_or(DEFAULT_MAX_EVALS_PER_MODEL),
                cooldown_ns: args.cooldown_ns.unwrap_or(U64(DEFAULT_COOLDOWN_NS)),
                status: BenchmarkStatus::Active,
                created_at_ns: U64(env::block_timestamp()),
                created_block: env::block_height(),
            },
        );
        self.benchmarks.flush();
        let used = env::storage_usage().saturating_sub(storage_before);
        let cost = env::storage_byte_cost().as_yoctonear() * u128::from(used);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= cost,
            format!("attach at least {cost} yoctoNEAR to cover storage")
        );
        refund(&owner, attached - cost);

        Event::BenchmarkRegistered {
            benchmark_id: id,
            owner,
        }
        .emit();
        id
    }

    pub fn retire_benchmark(&mut self, id: u64) {
        let caller = env::predecessor_account_id();
        match self.benchmarks.get_mut(&id) {
            Some(benchmark) => {
                require!(benchmark.owner == caller, "owner only");
                benchmark.status = BenchmarkStatus::Retired;
            }
            None => env::panic_str("benchmark not found"),
        }
    }

    // ---------- model team ----------

    #[payable]
    pub fn request_eval(&mut self, benchmark_id: u64, model_id: String, backend_id: String) -> u64 {
        let benchmark = self.benchmark(benchmark_id);
        require!(
            benchmark.status == BenchmarkStatus::Active,
            "benchmark is not active"
        );
        require!(
            self.models.get(&model_id).is_some_and(|m| m.active),
            "model is not on the active allowlist"
        );
        let backend = self.backend(&backend_id);
        require!(backend.active, "backend is not active");
        require!(
            backend.kind == BackendKind::OutLayer,
            "ShadeDstack backends are not supported until Part 2"
        );

        let now = env::block_timestamp();
        let usage_key = (benchmark_id, model_id.clone());
        if let Some(usage) = self.usage.get(&usage_key) {
            require!(
                usage.count < benchmark.max_evals_per_model,
                "eval limit reached for this model on this benchmark"
            );
            require!(
                now >= usage
                    .last_requested_ns
                    .0
                    .saturating_add(benchmark.cooldown_ns.0),
                "cooldown has not passed for this model on this benchmark"
            );
        }

        let shard_count = benchmark.shard_hashes.len() as u32;
        let compute_budget = compute_budget(shard_count);
        let required =
            benchmark.price.0 + compute_budget + self.eval_storage_deposit(shard_count).0;
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required,
            format!("attach a deposit of at least {required} yoctoNEAR")
        );
        let requester = env::predecessor_account_id();
        refund(&requester, attached - required);

        let count = self.usage.get(&usage_key).map_or(0, |u| u.count);
        self.usage.insert(
            usage_key,
            Usage {
                count: count + 1,
                last_requested_ns: U64(now),
            },
        );

        let id = self.next_eval_id;
        self.next_eval_id += 1;
        let mut eval = Eval {
            id,
            benchmark_id,
            requester: requester.clone(),
            model_id: model_id.clone(),
            backend_id,
            fee: benchmark.price,
            compute_budget: U128(compute_budget),
            compute_spent: U128(0),
            status: EvalStatus::Dispatching,
            next_shard_to_dispatch: 0,
            retries_left: MAX_RETRIES,
            retry_shards: Vec::new(),
            partials: vec![None; shard_count as usize],
            evidence_hashes: vec![None; shard_count as usize],
            nonce: hex::encode(env::random_seed_array()),
            created_at_ns: U64(now),
            created_block: env::block_height(),
            deadline_ns: U64(now + EVAL_DEADLINE_NS),
        };
        self.send_shard_runs(&mut eval, &benchmark, &backend);
        self.evals.insert(id, eval);

        Event::EvalRequested {
            eval_id: id,
            benchmark_id,
            model_id,
            requester,
        }
        .emit();
        id
    }

    /// Anyone can call this to move an eval along: it sends queued retries and unsent shards,
    /// or starts aggregation once every shard is graded.
    pub fn continue_dispatch(&mut self, eval_id: u64) {
        let mut eval = self.eval(eval_id);
        require!(
            env::block_timestamp() <= eval.deadline_ns.0,
            "the eval deadline has passed"
        );
        let benchmark = self.benchmark(eval.benchmark_id);
        let backend = self.backend(&eval.backend_id);
        let pending = eval.retry_shards.len() as u32 + eval.partials.len() as u32
            - eval.next_shard_to_dispatch;
        match eval.status {
            EvalStatus::Dispatching | EvalStatus::Grading if pending > 0 => {
                self.send_shard_runs(&mut eval, &benchmark, &backend);
            }
            EvalStatus::Grading if eval.partials.iter().all(Option::is_some) => {
                eval.status = EvalStatus::Aggregating;
                self.send_aggregate_run(&mut eval, &benchmark, &backend);
            }
            _ => env::panic_str("nothing to dispatch"),
        }
        self.evals.insert(eval_id, eval);
    }

    // ---------- callbacks ----------

    #[private]
    pub fn on_shard_graded(&mut self, eval_id: u64, shard_index: u32) {
        let Some(mut eval) = self.evals.get(&eval_id).cloned() else {
            return;
        };
        if !matches!(eval.status, EvalStatus::Dispatching | EvalStatus::Grading) {
            return;
        }
        let index = shard_index as usize;
        let Some(expected_hash) = self
            .benchmark(eval.benchmark_id)
            .shard_hashes
            .get(index)
            .cloned()
        else {
            eval.status = EvalStatus::Failed;
            self.evals.insert(eval_id, eval);
            return;
        };
        if eval.partials[index].is_some() {
            return;
        }

        match read_result::<GradeResult>() {
            Reply::Value(result)
                if result.ok
                    && result.eval_id == eval_id
                    && result.shard_index == shard_index
                    && result.shard_hash == expected_hash
                    && !result.sealed_partial.is_empty()
                    && merkle::parse_hash(&result.evidence_hash).is_some() =>
            {
                eval.partials[index] = Some(result.sealed_partial);
                eval.evidence_hashes[index] = Some(result.evidence_hash);
                Event::ShardGraded {
                    eval_id,
                    shard_index,
                }
                .emit();
            }
            Reply::Null if eval.retries_left > 0 => {
                eval.retries_left -= 1;
                eval.retry_shards.push(shard_index);
            }
            _ => eval.status = EvalStatus::Failed,
        }
        self.evals.insert(eval_id, eval);
    }

    #[private]
    pub fn on_aggregated(&mut self, eval_id: u64) {
        let Some(mut eval) = self.evals.get(&eval_id).cloned() else {
            return;
        };
        if eval.status != EvalStatus::Aggregating {
            return;
        }
        let benchmark = self.benchmark(eval.benchmark_id);

        match read_result::<AggregateResult>() {
            Reply::Value(result)
                if result.ok
                    && result.eval_id == eval_id
                    && result.n_items == benchmark.item_count
                    && result.n_correct <= result.n_items =>
            {
                self.certify(&mut eval, &benchmark, result);
            }
            Reply::Null if eval.retries_left > 0 => {
                eval.retries_left -= 1;
                eval.status = EvalStatus::Grading;
            }
            _ => eval.status = EvalStatus::Failed,
        }
        self.evals.insert(eval_id, eval);
    }

    // ---------- anyone ----------

    /// Refunds a failed eval at once, or any unfinished eval after its deadline.
    pub fn refund_expired(&mut self, eval_id: u64) {
        let mut eval = self.eval(eval_id);
        let expired = env::block_timestamp() > eval.deadline_ns.0;
        let refundable = match eval.status {
            EvalStatus::Failed => true,
            EvalStatus::Certified | EvalStatus::Refunded => false,
            _ => expired,
        };
        require!(refundable, "eval is not refundable");

        eval.status = EvalStatus::Refunded;
        let amount = eval.fee.0 + eval.compute_budget.0 - eval.compute_spent.0;
        let usage_key = (eval.benchmark_id, eval.model_id.clone());
        if let Some(usage) = self.usage.get_mut(&usage_key) {
            usage.count = usage.count.saturating_sub(1);
        }
        refund(&eval.requester, amount);
        self.evals.insert(eval_id, eval);
        Event::EvalRefunded {
            eval_id,
            amount: U128(amount),
        }
        .emit();
    }

    // ---------- views ----------

    pub fn get_benchmark(&self, id: u64) -> Option<Benchmark> {
        self.benchmarks.get(&id).cloned()
    }

    pub fn list_benchmarks(&self, from: u64, limit: u64) -> Vec<Benchmark> {
        (from..self.next_benchmark_id)
            .filter_map(|id| self.benchmarks.get(&id).cloned())
            .take(limit as usize)
            .collect()
    }

    pub fn get_eval(&self, id: u64) -> Option<Eval> {
        self.evals.get(&id).cloned()
    }

    pub fn get_certificate(&self, eval_id: u64) -> Option<Certificate> {
        self.certificates.get(&eval_id).cloned()
    }

    pub fn list_certificates(&self, benchmark_id: u64, from: u64, limit: u64) -> Vec<Certificate> {
        let Some(index) = self.cert_index.get(&benchmark_id) else {
            return Vec::new();
        };
        index
            .iter()
            .skip(from as usize)
            .take(limit as usize)
            .filter_map(|eval_id| self.certificates.get(eval_id).cloned())
            .collect()
    }

    pub fn get_backends(&self) -> Vec<Backend> {
        self.backends.values().cloned().collect()
    }

    pub fn get_models(&self) -> Vec<ModelInfo> {
        self.models.values().cloned().collect()
    }

    pub fn get_usage(&self, benchmark_id: u64, model_id: String) -> Option<Usage> {
        self.usage.get(&(benchmark_id, model_id)).cloned()
    }

    /// Non-refundable storage charge for one eval and its certificate.
    pub fn eval_storage_deposit(&self, shard_count: u32) -> U128 {
        let bytes = EVAL_STORAGE_BASE_BYTES + u64::from(shard_count) * EVAL_STORAGE_PER_SHARD_BYTES;
        U128(env::storage_byte_cost().as_yoctonear() * u128::from(bytes))
    }
}

impl BlindMark {
    fn assert_admin(&self) {
        require!(env::predecessor_account_id() == self.admin, "admin only");
    }

    fn benchmark(&self, id: u64) -> Benchmark {
        self.benchmarks
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("benchmark not found"))
    }

    fn backend(&self, id: &String) -> Backend {
        self.backends
            .get(id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("backend not found"))
    }

    fn eval(&self, id: u64) -> Eval {
        self.evals
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("eval not found"))
    }

    /// Sends up to `MAX_DISPATCH_PER_TX` grade runs: queued retries first, then unsent shards.
    fn send_shard_runs(&self, eval: &mut Eval, benchmark: &Benchmark, backend: &Backend) {
        let shard_count = eval.partials.len() as u32;
        for _ in 0..MAX_DISPATCH_PER_TX {
            let shard_index = if eval.retry_shards.is_empty() {
                if eval.next_shard_to_dispatch >= shard_count {
                    break;
                }
                eval.next_shard_to_dispatch += 1;
                eval.next_shard_to_dispatch - 1
            } else {
                eval.retry_shards.remove(0)
            };
            self.send_grade_run(eval, benchmark, backend, shard_index);
        }
        if eval.status == EvalStatus::Dispatching && eval.next_shard_to_dispatch == shard_count {
            eval.status = EvalStatus::Grading;
        }
    }

    fn send_grade_run(
        &self,
        eval: &mut Eval,
        benchmark: &Benchmark,
        backend: &Backend,
        shard_index: u32,
    ) {
        let index = shard_index as usize;
        let leaves: Vec<Hash> = benchmark
            .shard_hashes
            .iter()
            .filter_map(|h| merkle::parse_hash(h))
            .collect();
        let request = GradeRequest {
            mode: "grade".to_string(),
            eval_id: eval.id,
            benchmark_id: benchmark.id,
            version: benchmark.version,
            shard_index,
            shard_uri: benchmark.shard_uris[index].clone(),
            shard_hash: benchmark.shard_hashes[index].clone(),
            merkle_proof: merkle::proof(&leaves, index).unwrap_or_default(),
            dataset_root: benchmark.dataset_root.clone(),
            protocol_uri: benchmark.protocol_uri.clone(),
            protocol_hash: benchmark.protocol_hash.clone(),
            model_id: eval.model_id.clone(),
            nonce: eval.nonce.clone(),
        };
        let secrets_ref = json!({
            "profile": benchmark.secret_ref.profile,
            "account_id": benchmark.secret_ref.owner,
        });
        let callback = Self::ext(env::current_account_id())
            .with_static_gas(SHARD_CALLBACK_GAS)
            .on_shard_graded(eval.id, shard_index);
        self.send_run(eval, backend, &request, secrets_ref, callback);
    }

    fn send_aggregate_run(&self, eval: &mut Eval, benchmark: &Benchmark, backend: &Backend) {
        let request = AggregateRequest {
            mode: "aggregate".to_string(),
            eval_id: eval.id,
            expected_shards: eval.partials.len() as u32,
            sealed_partials: eval
                .partials
                .iter()
                .enumerate()
                .filter_map(|(i, sealed)| {
                    sealed.clone().map(|sealed| SealedPartialEntry {
                        shard_index: i as u32,
                        sealed,
                    })
                })
                .collect(),
            n_items_expected: benchmark.item_count,
            nonce: eval.nonce.clone(),
        };
        let callback = Self::ext(env::current_account_id())
            .with_static_gas(AGGREGATE_CALLBACK_GAS)
            .on_aggregated(eval.id);
        self.send_run(eval, backend, &request, Value::Null, callback);
    }

    /// Sends one pinned OutLayer run. Spec: CLAUDE.md section 7.3.
    fn send_run<T: near_sdk::serde::Serialize>(
        &self,
        eval: &mut Eval,
        backend: &Backend,
        request: &T,
        secrets_ref: Value,
        callback: Promise,
    ) {
        let input = serde_json::to_string(request)
            .unwrap_or_else(|_| env::panic_str("could not serialize the grader request"));
        let args = json!({
            "source": { "Project": {
                "project_id": backend.outlayer_project,
                "version_key": backend.measurement,
            } },
            "resource_limits": {
                "max_instructions": 500_000_000_000u64,
                "max_memory_mb": 256,
                "max_execution_seconds": 180,
            },
            "input_data": input,
            "secrets_ref": secrets_ref,
            "response_format": "Json",
            "payer_account_id": eval.requester,
        });
        eval.compute_spent = U128(eval.compute_spent.0 + COMPUTE_PER_RUN);
        Promise::new(self.outlayer_contract.clone())
            .function_call(
                "request_execution".to_string(),
                args.to_string().into_bytes(),
                NearToken::from_yoctonear(COMPUTE_PER_RUN),
                REQUEST_GAS,
            )
            .then(callback)
            .detach();
    }

    fn certify(&mut self, eval: &mut Eval, benchmark: &Benchmark, result: AggregateResult) {
        let backend = self.backend(&eval.backend_id);
        let tier = self
            .models
            .get(&eval.model_id)
            .map(|m| m.tier.clone())
            .unwrap_or_default();
        self.certificates.insert(
            eval.id,
            Certificate {
                eval_id: eval.id,
                benchmark_id: benchmark.id,
                benchmark_version: benchmark.version,
                dataset_root: benchmark.dataset_root.clone(),
                protocol_hash: benchmark.protocol_hash.clone(),
                model_id: eval.model_id.clone(),
                trust_tier: tier,
                backend_id: eval.backend_id.clone(),
                grader_measurement: backend.measurement,
                n_items: result.n_items,
                n_correct: result.n_correct,
                score_bps: result.score_bps,
                ci_low_bps: result.ci_low_bps,
                ci_high_bps: result.ci_high_bps,
                mean_latency_ms: result.mean_latency_ms,
                evidence_hashes: eval.evidence_hashes.iter().flatten().cloned().collect(),
                issued_at_ns: U64(env::block_timestamp()),
                issued_block: env::block_height(),
            },
        );
        match self.cert_index.get_mut(&benchmark.id) {
            Some(index) => index.push(eval.id),
            None => {
                let mut index = Vector::new(StorageKey::CertIndexInner {
                    benchmark_id: benchmark.id,
                });
                index.push(eval.id);
                self.cert_index.insert(benchmark.id, index);
            }
        }
        eval.status = EvalStatus::Certified;

        let fee = eval.fee.0 * u128::from(self.platform_fee_bps) / u128::from(MAX_FEE_BPS);
        refund(&self.treasury, fee);
        refund(&benchmark.owner, eval.fee.0 - fee);
        refund(
            &eval.requester,
            eval.compute_budget.0 - eval.compute_spent.0,
        );
        Event::EvalCertified {
            eval_id: eval.id,
            benchmark_id: benchmark.id,
            model_id: eval.model_id.clone(),
            score_bps: result.score_bps,
        }
        .emit();
    }

    #[cfg(test)]
    fn flush_for_test(&mut self) {
        self.benchmarks.flush();
        self.evals.flush();
        self.certificates.flush();
        self.cert_index.flush();
        self.usage.flush();
    }
}

fn compute_budget(shard_count: u32) -> u128 {
    u128::from(shard_count + 1 + MAX_RETRIES) * COMPUTE_PER_RUN
}

/// Sends `amount` to `account`, skipping zero amounts.
fn refund(account: &AccountId, amount: u128) {
    if amount > 0 {
        Promise::new(account.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .detach();
    }
}

/// What OutLayer sent back to a callback.
enum Reply<T> {
    Value(T),
    /// The run produced no result: lost, crashed or printed non-JSON (CLAUDE.md section 7.3).
    Null,
    /// The promise failed, or the result was oversized or malformed.
    Rejected,
}

/// Reads the callback's promise result without panicking, so a rejection still saves `Failed`.
fn read_result<T: near_sdk::serde::de::DeserializeOwned>() -> Reply<T> {
    let Ok(bytes) = env::promise_result_checked(0, MAX_RESULT_BYTES) else {
        return Reply::Rejected;
    };
    match serde_json::from_slice::<Option<T>>(&bytes) {
        Ok(Some(value)) => Reply::Value(value),
        Ok(None) => Reply::Null,
        Err(_) => Reply::Rejected,
    }
}
