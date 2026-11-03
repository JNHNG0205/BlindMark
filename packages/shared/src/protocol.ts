// Protocol hashing. Spec: CLAUDE.md section 5.2.
import { sha256 } from "@noble/hashes/sha2.js";
import { toHex } from "./hex.js";
import { canonicalize } from "./jcs.js";

/** sha256(JCS(protocol)), lowercase hex. */
export function protocolHash(protocol: unknown): string {
  return toHex(sha256(new TextEncoder().encode(canonicalize(protocol))));
}
