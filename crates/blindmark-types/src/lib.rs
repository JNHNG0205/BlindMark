//! Shared types, Merkle commitment, crypto envelope and statistics.
//!
//! Used by both the contract and the grader, so this crate must stay free of
//! NEAR and WASI dependencies.

pub mod merkle;
pub mod wire;
