//! Checks the Rust Merkle code against vectors from an independent implementation.

#![allow(clippy::unwrap_used)] // `allow-unwrap-in-tests` does not reach helper functions here.

use blindmark_types::merkle::{ProofStep, Side, leaf_hash, parse_hash, proof, root, verify};
use serde_json::Value;

fn vectors() -> Vec<Value> {
    let all: Value = serde_json::from_str(include_str!("vectors.json")).unwrap();
    all["merkle"].as_array().unwrap().clone()
}

fn hash_list(value: &Value) -> Vec<[u8; 32]> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|h| parse_hash(h.as_str().unwrap()).unwrap())
        .collect()
}

#[test]
fn leaf_hash_matches_vectors() {
    for case in vectors() {
        let leaves = hash_list(&case["leaves"]);
        for (ct, expected) in case["ciphertexts_utf8"]
            .as_array()
            .unwrap()
            .iter()
            .zip(&leaves)
        {
            assert_eq!(&leaf_hash(ct.as_str().unwrap().as_bytes()), expected);
        }
    }
}

#[test]
fn root_matches_vectors() {
    for case in vectors() {
        let leaves = hash_list(&case["leaves"]);
        let expected = parse_hash(case["root"].as_str().unwrap()).unwrap();
        assert_eq!(root(&leaves), Some(expected), "n = {}", leaves.len());
    }
}

#[test]
fn proof_matches_vectors_and_verifies() {
    for case in vectors() {
        let leaves = hash_list(&case["leaves"]);
        let expected_root = parse_hash(case["root"].as_str().unwrap()).unwrap();
        for (i, expected) in case["proofs"].as_array().unwrap().iter().enumerate() {
            let expected: Vec<ProofStep> = serde_json::from_value(expected.clone()).unwrap();
            let actual = proof(&leaves, i).unwrap();
            assert_eq!(actual, expected, "n = {}, i = {i}", leaves.len());
            assert!(verify(&leaves[i], &actual, &expected_root));
        }
    }
}

#[test]
fn root_of_no_leaves_is_none() {
    assert_eq!(root(&[]), None);
}

#[test]
fn proof_index_out_of_range_is_none() {
    let leaves = [leaf_hash(b"a"), leaf_hash(b"b")];
    assert_eq!(proof(&leaves, 2), None);
}

#[test]
fn verify_rejects_wrong_leaf() {
    let leaves = [leaf_hash(b"a"), leaf_hash(b"b"), leaf_hash(b"c")];
    let top = root(&leaves).unwrap();
    let path = proof(&leaves, 0).unwrap();
    assert!(!verify(&leaf_hash(b"tampered"), &path, &top));
}

#[test]
fn verify_rejects_flipped_side() {
    let leaves = [leaf_hash(b"a"), leaf_hash(b"b")];
    let top = root(&leaves).unwrap();
    let mut path = proof(&leaves, 0).unwrap();
    path[0].side = Side::L;
    assert!(!verify(&leaves[0], &path, &top));
}

#[test]
fn verify_rejects_malformed_sibling_hash() {
    let leaves = [leaf_hash(b"a"), leaf_hash(b"b")];
    let top = root(&leaves).unwrap();
    let mut path = proof(&leaves, 0).unwrap();
    path[0].hash = "not-hex".to_string();
    assert!(!verify(&leaves[0], &path, &top));
}

#[test]
fn leaf_and_node_domains_are_separated() {
    // A two-leaf root must not be forgeable as a leaf over the concatenated children.
    let (a, b) = (leaf_hash(b"a"), leaf_hash(b"b"));
    let concatenated = [a, b].concat();
    assert_ne!(root(&[a, b]).unwrap(), leaf_hash(&concatenated));
}

#[test]
fn parse_hash_accepts_only_64_lowercase_hex() {
    assert!(parse_hash(&"a".repeat(64)).is_some());
    assert!(parse_hash(&"A".repeat(64)).is_none());
    assert!(parse_hash(&"a".repeat(63)).is_none());
    assert!(parse_hash(&"g".repeat(64)).is_none());
}
