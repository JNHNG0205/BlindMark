//! TEST ONLY. A fake grader for checking the contract end to end on testnet before the real
//! grader exists. It reads nothing secret, calls no model and grades nothing, so its
//! certificates mean nothing. Register it only under the `test-stub` backend, never for a demo
//! or a real benchmark. Uses the real message types so the shapes match the contract.

use std::io::{Read, Write};
use std::process::ExitCode;

use blindmark_types::wire::{AggregateRequest, AggregateResult, GradeRequest, GradeResult};

/// sha256 of the empty string, standing in for an evidence bundle hash.
const NO_EVIDENCE: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

fn main() -> ExitCode {
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        return ExitCode::FAILURE;
    }
    let Ok(request) = serde_json::from_str::<serde_json::Value>(&input) else {
        return ExitCode::FAILURE;
    };
    let output = match request["mode"].as_str() {
        Some("grade") => serde_json::from_value::<GradeRequest>(request).map(|r| {
            serde_json::to_string(&GradeResult {
                eval_id: r.eval_id,
                shard_index: r.shard_index,
                shard_hash: r.shard_hash,
                sealed_partial: "test-stub".to_string(),
                evidence_hash: NO_EVIDENCE.to_string(),
                backend: "test-stub".to_string(),
                ok: true,
                error: None,
            })
        }),
        Some("aggregate") => serde_json::from_value::<AggregateRequest>(request).map(|r| {
            serde_json::to_string(&AggregateResult {
                eval_id: r.eval_id,
                n_items: r.n_items_expected,
                n_correct: 0,
                score_bps: 0,
                ci_low_bps: 0,
                ci_high_bps: 0,
                mean_latency_ms: 0,
                ok: true,
                error: None,
            })
        }),
        _ => return ExitCode::FAILURE,
    };
    let Ok(Ok(json)) = output else {
        return ExitCode::FAILURE;
    };
    let mut stdout = std::io::stdout();
    if stdout.write_all(json.as_bytes()).is_err() || stdout.flush().is_err() {
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
