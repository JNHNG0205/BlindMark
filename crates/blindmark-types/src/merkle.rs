//! Merkle commitment over shard ciphertexts. Spec: CLAUDE.md section 5.4.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub type Hash = [u8; 32];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Side {
    L,
    R,
}

/// One step of a proof, from leaf towards root. `hash` is the sibling, lowercase hex.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProofStep {
    pub hash: String,
    pub side: Side,
}

pub fn leaf_hash(ciphertext: &[u8]) -> Hash {
    Sha256::new()
        .chain_update([0x00])
        .chain_update(ciphertext)
        .finalize()
        .into()
}

fn node_hash(left: &Hash, right: &Hash) -> Hash {
    Sha256::new()
        .chain_update([0x01])
        .chain_update(left)
        .chain_update(right)
        .finalize()
        .into()
}

/// Hashes one level into the next. An odd last node is promoted unchanged.
fn next_level(level: &[Hash]) -> Vec<Hash> {
    level
        .chunks(2)
        .map(|pair| match pair {
            [left, right] => node_hash(left, right),
            [only] => *only,
            _ => unreachable!("chunks(2) yields one or two items"),
        })
        .collect()
}

/// Returns `None` when there are no leaves.
pub fn root(leaves: &[Hash]) -> Option<Hash> {
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        level = next_level(&level);
    }
    level.first().copied()
}

/// Returns `None` when `index` is out of range.
pub fn proof(leaves: &[Hash], index: usize) -> Option<Vec<ProofStep>> {
    if index >= leaves.len() {
        return None;
    }
    let mut steps = Vec::new();
    let mut level = leaves.to_vec();
    let mut position = index;
    while level.len() > 1 {
        let sibling = position ^ 1;
        if let Some(hash) = level.get(sibling) {
            steps.push(ProofStep {
                hash: hex::encode(hash),
                side: if sibling < position { Side::L } else { Side::R },
            });
        }
        level = next_level(&level);
        position /= 2;
    }
    Some(steps)
}

pub fn verify(leaf: &Hash, proof: &[ProofStep], root: &Hash) -> bool {
    let mut current = *leaf;
    for step in proof {
        let Some(sibling) = parse_hash(&step.hash) else {
            return false;
        };
        current = match step.side {
            Side::L => node_hash(&sibling, &current),
            Side::R => node_hash(&current, &sibling),
        };
    }
    current == *root
}

/// Parses 64 lowercase hex characters. Uppercase is rejected so each hash has one spelling.
pub fn parse_hash(text: &str) -> Option<Hash> {
    if text.bytes().any(|b| b.is_ascii_uppercase()) {
        return None;
    }
    let mut out = [0u8; 32];
    hex::decode_to_slice(text, &mut out).ok()?;
    Some(out)
}
