//! Contract to grader messages. Spec: CLAUDE.md section 6.

use serde::{Deserialize, Serialize};

use crate::merkle::ProofStep;

/// The most bytes a serialized `GradeResult` or `AggregateResult` may take.
pub const MAX_RESULT_BYTES: usize = 900;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GradeRequest {
    pub mode: String,
    pub eval_id: u64,
    pub benchmark_id: u64,
    pub version: u32,
    pub shard_index: u32,
    pub shard_uri: String,
    pub shard_hash: String,
    pub merkle_proof: Vec<ProofStep>,
    pub dataset_root: String,
    pub protocol_uri: String,
    pub protocol_hash: String,
    pub model_id: String,
    pub nonce: String,
}

/// Must serialize to at most 900 bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GradeResult {
    pub eval_id: u64,
    pub shard_index: u32,
    pub shard_hash: String,
    pub sealed_partial: String,
    pub evidence_hash: String,
    pub backend: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SealedPartialEntry {
    pub shard_index: u32,
    pub sealed: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AggregateRequest {
    pub mode: String,
    pub eval_id: u64,
    pub expected_shards: u32,
    pub sealed_partials: Vec<SealedPartialEntry>,
    pub n_items_expected: u32,
    pub nonce: String,
}

/// Must serialize to at most 900 bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AggregateResult {
    pub eval_id: u64,
    pub n_items: u32,
    pub n_correct: u32,
    pub score_bps: u32,
    pub ci_low_bps: u32,
    pub ci_high_bps: u32,
    pub mean_latency_ms: u64,
    pub ok: bool,
    pub error: Option<String>,
}
