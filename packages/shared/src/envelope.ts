// Shard envelope encryption. Spec: CLAUDE.md section 5.3.
//
// Every function here handles K or plaintext items. None of them may log, persist or return
// K or item content anywhere except to the caller.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { concatBytes } from "./hex.js";

export const ENVELOPE_VERSION = 0x01;
export const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;
/** Shard plaintext must stay at most 200 KiB. */
export const MAX_SHARD_PLAINTEXT_BYTES = 200 * 1024;

export interface ShardId {
  benchmark_id: number;
  version: number;
  shard_index: number;
}

export function shardAad({
  benchmark_id,
  version,
  shard_index,
}: ShardId): Uint8Array {
  return new TextEncoder().encode(
    `blindmark:v1:${benchmark_id}:${version}:${shard_index}`,
  );
}

/** A fresh random K. Never log it, store it in the browser, or put it in a URL. */
export function generateKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

/** Returns `0x01 || nonce(24) || ciphertext`. Never log `key` or `plaintext`. */
export function encryptShard(
  key: Uint8Array,
  id: ShardId,
  plaintext: Uint8Array,
  nonce: Uint8Array = crypto.getRandomValues(new Uint8Array(NONCE_BYTES)),
): Uint8Array {
  if (key.length !== KEY_BYTES) throw new Error("K must be 32 bytes");
  if (nonce.length !== NONCE_BYTES) throw new Error("nonce must be 24 bytes");
  const sealed = xchacha20poly1305(key, nonce, shardAad(id)).encrypt(plaintext);
  return concatBytes(Uint8Array.of(ENVELOPE_VERSION), nonce, sealed);
}

/** Throws on a wrong key, AAD or tampered bytes. Never log `key` or the returned plaintext. */
export function decryptShard(
  key: Uint8Array,
  id: ShardId,
  wire: Uint8Array,
): Uint8Array {
  if (key.length !== KEY_BYTES) throw new Error("K must be 32 bytes");
  if (
    wire.length < 1 + NONCE_BYTES + TAG_BYTES ||
    wire[0] !== ENVELOPE_VERSION
  ) {
    throw new Error("not a v1 shard envelope");
  }
  const nonce = wire.subarray(1, 1 + NONCE_BYTES);
  return xchacha20poly1305(key, nonce, shardAad(id)).decrypt(
    wire.subarray(1 + NONCE_BYTES),
  );
}
