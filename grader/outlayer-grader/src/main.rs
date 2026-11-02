//! Part 1 grader, OutLayer WASM with modes `grade` and `aggregate`. Spec: CLAUDE.md section 8.

use std::process::ExitCode;

/// Fails closed until implemented: a stub must never emit a result the contract could certify.
fn main() -> ExitCode {
    eprintln!("outlayer-grader: not implemented");
    ExitCode::FAILURE
}
