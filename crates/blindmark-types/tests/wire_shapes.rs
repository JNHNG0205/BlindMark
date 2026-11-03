//! The message types must accept and produce the exact JSON shapes in CLAUDE.md section 6.

#![allow(clippy::unwrap_used)] // `allow-unwrap-in-tests` does not reach helper functions here.

use blindmark_types::merkle::Side;
use blindmark_types::wire::{
    AggregateRequest, AggregateResult, GradeRequest, GradeResult, MAX_RESULT_BYTES,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

/// Parses the JSON into `T` and checks that serializing gives the same JSON back.
fn round_trip<T: Serialize + DeserializeOwned>(shape: Value) -> T {
    let parsed: T = serde_json::from_value(shape.clone()).unwrap();
    assert_eq!(serde_json::to_value(&parsed).unwrap(), shape);
    parsed
}

#[test]
fn grade_request_matches_spec() {
    let request: GradeRequest = round_trip(json!({
        "mode": "grade", "eval_id": 42, "benchmark_id": 7, "version": 1, "shard_index": 3,
        "shard_uri": "https://example.test/shard-0003.bin", "shard_hash": "aa",
        "merkle_proof": [{ "hash": "bb", "side": "L" }],
        "dataset_root": "cc", "protocol_uri": "https://example.test/protocol.json",
        "protocol_hash": "dd", "model_id": "model", "nonce": "ee"
    }));
    assert_eq!(request.merkle_proof[0].side, Side::L);
}

#[test]
fn grade_result_matches_spec() {
    let result: GradeResult = round_trip(json!({
        "eval_id": 42, "shard_index": 3, "shard_hash": "aa", "sealed_partial": "c2VhbGVk",
        "evidence_hash": "bb", "backend": "outlayer-v1", "ok": true, "error": null
    }));
    assert!(result.ok);
}

#[test]
fn aggregate_request_matches_spec() {
    let request: AggregateRequest = round_trip(json!({
        "mode": "aggregate", "eval_id": 42, "expected_shards": 10,
        "sealed_partials": [{ "shard_index": 0, "sealed": "c2VhbGVk" }],
        "n_items_expected": 500, "nonce": "ee"
    }));
    assert_eq!(request.sealed_partials[0].shard_index, 0);
}

#[test]
fn aggregate_result_matches_spec() {
    let result: AggregateResult = round_trip(json!({
        "eval_id": 42, "n_items": 500, "n_correct": 361, "score_bps": 7220,
        "ci_low_bps": 6812, "ci_high_bps": 7595, "mean_latency_ms": 1840,
        "ok": true, "error": null
    }));
    assert_eq!(result.n_correct, 361);
}

#[test]
fn result_size_limit_matches_spec() {
    assert_eq!(MAX_RESULT_BYTES, 900);
}
