// Merkle commitment over shard ciphertexts. Spec: CLAUDE.md section 5.4.
// Mirrors crates/blindmark-types/src/merkle.rs.
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, equalBytes, parseHash, toHex } from "./hex.js";

export type Side = "L" | "R";

/** One step of a proof, from leaf towards root. `hash` is the sibling, lowercase hex. */
export interface ProofStep {
  hash: string;
  side: Side;
}

export function leafHash(ciphertext: Uint8Array): Uint8Array {
  return sha256(concatBytes(Uint8Array.of(0x00), ciphertext));
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(Uint8Array.of(0x01), left, right));
}

/** Hashes one level into the next. An odd last node is promoted unchanged. */
function nextLevel(level: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i]!;
    const right = level[i + 1];
    out.push(right ? nodeHash(left, right) : left);
  }
  return out;
}

/** Returns null when there are no leaves. */
export function merkleRoot(leaves: Uint8Array[]): Uint8Array | null {
  let level = leaves;
  while (level.length > 1) level = nextLevel(level);
  return level[0] ?? null;
}

/** Returns null when `index` is out of range. */
export function merkleProof(
  leaves: Uint8Array[],
  index: number,
): ProofStep[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length)
    return null;
  const steps: ProofStep[] = [];
  let level = leaves;
  let position = index;
  while (level.length > 1) {
    const sibling = position ^ 1;
    const hash = level[sibling];
    if (hash) {
      steps.push({ hash: toHex(hash), side: sibling < position ? "L" : "R" });
    }
    level = nextLevel(level);
    position = Math.floor(position / 2);
  }
  return steps;
}

export function verifyProof(
  leaf: Uint8Array,
  proof: ProofStep[],
  root: Uint8Array,
): boolean {
  let current = leaf;
  for (const step of proof) {
    const sibling = parseHash(step.hash);
    if (!sibling) return false;
    if (step.side === "L") current = nodeHash(sibling, current);
    else if (step.side === "R") current = nodeHash(current, sibling);
    else return false;
  }
  return equalBytes(current, root);
}

/** Recomputes `dataset_root` from hex shard hashes. Null if any hash is malformed or none given. */
export function rootFromHexLeaves(shardHashes: string[]): string | null {
  const leaves = shardHashes.map(parseHash);
  if (leaves.some((l) => l === null)) return null;
  const root = merkleRoot(leaves as Uint8Array[]);
  return root ? toHex(root) : null;
}
