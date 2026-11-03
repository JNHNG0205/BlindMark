//! Contract state records. Spec: CLAUDE.md section 7.1.
//!
//! Nanosecond fields use `U64` because they exceed what a JavaScript number holds exactly.

use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, near};

pub type SealedPartial = String;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum BackendKind {
    OutLayer,
    ShadeDstack,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Backend {
    pub id: String,
    pub kind: BackendKind,
    /// WASM sha256 or image digest. Also the OutLayer `version_key`.
    pub measurement: String,
    pub outlayer_project: Option<String>,
    pub active: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ModelInfo {
    pub id: String,
    pub tier: String,
    pub active: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SecretRef {
    pub owner: AccountId,
    pub profile: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum BenchmarkStatus {
    Active,
    Retired,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct RegisterBenchmarkArgs {
    pub version: u32,
    pub title: String,
    pub description: String,
    pub grading_type: String,
    pub dataset_root: String,
    pub protocol_hash: String,
    pub protocol_uri: String,
    pub shard_uris: Vec<String>,
    pub shard_hashes: Vec<String>,
    pub item_count: u32,
    pub sample_items_uri: Option<String>,
    pub price: U128,
    pub secret_ref: SecretRef,
    /// Defaults to 3.
    pub max_evals_per_model: Option<u32>,
    /// Defaults to 24 hours.
    pub cooldown_ns: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Benchmark {
    pub id: u64,
    pub version: u32,
    pub owner: AccountId,
    pub title: String,
    pub description: String,
    pub grading_type: String,
    pub dataset_root: String,
    pub protocol_hash: String,
    pub protocol_uri: String,
    pub shard_uris: Vec<String>,
    pub shard_hashes: Vec<String>,
    pub item_count: u32,
    pub sample_items_uri: Option<String>,
    pub price: U128,
    pub secret_ref: SecretRef,
    pub max_evals_per_model: u32,
    pub cooldown_ns: U64,
    pub status: BenchmarkStatus,
    pub created_at_ns: U64,
    pub created_block: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EvalStatus {
    Dispatching,
    Grading,
    Aggregating,
    Certified,
    Failed,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Eval {
    pub id: u64,
    pub benchmark_id: u64,
    pub requester: AccountId,
    pub model_id: String,
    pub backend_id: String,
    pub fee: U128,
    pub compute_budget: U128,
    pub compute_spent: U128,
    pub status: EvalStatus,
    pub next_shard_to_dispatch: u32,
    pub retries_left: u32,
    pub retry_shards: Vec<u32>,
    pub partials: Vec<Option<SealedPartial>>,
    pub evidence_hashes: Vec<Option<String>>,
    pub nonce: String,
    pub created_at_ns: U64,
    pub created_block: u64,
    pub deadline_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Certificate {
    pub eval_id: u64,
    pub benchmark_id: u64,
    pub benchmark_version: u32,
    pub dataset_root: String,
    pub protocol_hash: String,
    pub model_id: String,
    pub trust_tier: String,
    pub backend_id: String,
    pub grader_measurement: String,
    pub n_items: u32,
    pub n_correct: u32,
    pub score_bps: u32,
    pub ci_low_bps: u32,
    pub ci_high_bps: u32,
    pub mean_latency_ms: u64,
    pub evidence_hashes: Vec<String>,
    pub issued_at_ns: U64,
    pub issued_block: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Usage {
    pub count: u32,
    pub last_requested_ns: U64,
}
