// Builds encrypted shards and the Merkle commitment from plaintext items. Spec: CLAUDE.md
// sections 5.1, 5.3 and 5.4.
//
// Handles K and plaintext items: never log them, and return them only to the caller.
import {
  MAX_SHARD_PLAINTEXT_BYTES,
  encryptShard,
  type ShardId,
} from "./envelope.js";
import { toHex } from "./hex.js";
import { leafHash, merkleRoot } from "./merkle.js";
import { GRADING_TYPES, type Item, type ShardPlaintext } from "./types.js";

export const DEFAULT_ITEMS_PER_SHARD = 50;
export const MAX_SHARDS = 64;

export interface EncryptedShard {
  shard_index: number;
  item_count: number;
  ciphertext: Uint8Array;
  /** sha256(0x00 || ciphertext), lowercase hex. */
  hash: string;
}

export interface EncryptedBenchmark {
  shards: EncryptedShard[];
  dataset_root: string;
  item_count: number;
}

/**
 * Parses one item per line. Error messages name the line number and field only, never the
 * line's content, so they are safe to show.
 */
export function parseItemsJsonl(text: string): Item[] {
  const items: Item[] = [];
  const ids = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1}: not valid JSON`);
    }
    const item = validateItem(value, i + 1);
    if (ids.has(item.id)) throw new Error(`line ${i + 1}: duplicate id`);
    ids.add(item.id);
    items.push(item);
  });
  if (items.length === 0) throw new Error("no items found");
  return items;
}

function validateItem(value: unknown, line: number): Item {
  const fail = (field: string): never => {
    throw new Error(`line ${line}: invalid or missing "${field}"`);
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`line ${line}: expected a JSON object`);
  }
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id === "") fail("id");
  if (typeof v.prompt !== "string" || v.prompt === "") fail("prompt");
  if (typeof v.answer !== "string") fail("answer");
  const choices = v.choices ?? null;
  if (
    choices !== null &&
    !(Array.isArray(choices) && choices.every((c) => typeof c === "string"))
  ) {
    fail("choices");
  }
  const gradingType = v.grading_type ?? null;
  if (
    gradingType !== null &&
    !GRADING_TYPES.includes(gradingType as Item["grading_type"] & string)
  ) {
    fail("grading_type");
  }
  const rubric = v.rubric ?? null;
  if (rubric !== null && typeof rubric !== "string") fail("rubric");
  const metadata = v.metadata;
  if (
    metadata !== undefined &&
    (typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata))
  ) {
    fail("metadata");
  }
  return {
    id: v.id as string,
    prompt: v.prompt as string,
    choices: choices as string[] | null,
    answer: v.answer as string,
    grading_type: gradingType as Item["grading_type"],
    rubric: rubric as string | null,
    ...(metadata === undefined
      ? {}
      : { metadata: metadata as Record<string, unknown> }),
  };
}

/** Compact JSON (UTF-8) of the shard plaintext. Private. */
export function shardPlaintextBytes(shard: ShardPlaintext): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(shard));
}

/** Groups items into shards of at most `itemsPerShard`, encrypts them with K and commits. */
export function encryptBenchmark(
  items: Item[],
  key: Uint8Array,
  ids: { benchmark_id: number; version: number },
  itemsPerShard = DEFAULT_ITEMS_PER_SHARD,
): EncryptedBenchmark {
  if (!Number.isInteger(itemsPerShard) || itemsPerShard < 1) {
    throw new Error("items per shard must be a positive integer");
  }
  const count = Math.ceil(items.length / itemsPerShard);
  if (count < 1 || count > MAX_SHARDS) {
    throw new Error(
      `a benchmark needs 1 to ${MAX_SHARDS} shards, got ${count}`,
    );
  }
  const shards: EncryptedShard[] = [];
  for (let shard_index = 0; shard_index < count; shard_index++) {
    const shardItems = items.slice(
      shard_index * itemsPerShard,
      (shard_index + 1) * itemsPerShard,
    );
    const id: ShardId = { ...ids, shard_index };
    const plaintext = shardPlaintextBytes({ ...id, items: shardItems });
    if (plaintext.length > MAX_SHARD_PLAINTEXT_BYTES) {
      throw new Error(
        `shard ${shard_index} is ${plaintext.length} bytes; the limit is ${MAX_SHARD_PLAINTEXT_BYTES}. Use fewer items per shard.`,
      );
    }
    const ciphertext = encryptShard(key, id, plaintext);
    shards.push({
      shard_index,
      item_count: shardItems.length,
      ciphertext,
      hash: toHex(leafHash(ciphertext)),
    });
  }
  const root = merkleRoot(shards.map((s) => leafHash(s.ciphertext)));
  if (!root) throw new Error("no shards");
  return { shards, dataset_root: toHex(root), item_count: items.length };
}

/** Public name of a shard file, e.g. `shard-0003.bin`. */
export function shardFileName(shardIndex: number): string {
  return `shard-${String(shardIndex).padStart(4, "0")}.bin`;
}
