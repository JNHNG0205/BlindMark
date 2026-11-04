// Creating the owner's K secret in OutLayer from the browser (CLAUDE.md sections 8 and 11).
//
// Flow, taken from OutLayer's dashboard and contract source (docs/REFERENCES.md):
// 1. POST <api>/secrets/pubkey { accessor, owner, secrets_json } returns the keystore's X25519
//    public key for that (accessor, owner). The keystore uses `secrets_json` only to check the
//    variable names, so this page sends a placeholder value there, never K.
// 2. Encrypt {"BLINDMARK_K":"<hex K>"} to that key with the keystore's ECIES:
//    [0x01 | ephemeral X25519 public key (32) | nonce (12) | ChaCha20-Poly1305 ciphertext and tag],
//    key = HKDF-SHA256(shared secret, no salt, info "outlayer-keystore-v1").
// 3. Call `store_secrets` on the OutLayer contract with the exact deposit from the
//    `estimate_storage_cost` view.
//
// K leaves the browser only inside that ciphertext. Nothing here may log, return or store K or
// the plaintext secrets JSON.
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromHex, toHex } from "@blindmark/shared";

export const SECRET_ENV_NAME = "BLINDMARK_K";
const HKDF_INFO = new TextEncoder().encode("outlayer-keystore-v1");
const ECIES_VERSION = 0x01;

/** Section 8 access condition: only the approved build, called through our contract. */
export function kAccessCondition(
  graderMeasurement: string,
  contractId: string,
) {
  return {
    Logic: {
      operator: "And",
      conditions: [
        { WasmHash: { hash: graderMeasurement } },
        {
          Predecessor: {
            condition: { Whitelist: { accounts: [contractId] } },
          },
        },
      ],
    },
  };
}

/** The secret is bound to the grader's OutLayer project, which the contract runs. */
export function projectAccessor(projectId: string) {
  return { Project: { project_id: projectId } };
}

/** Derives the symmetric key both sides compute from an X25519 shared secret. */
function eciesKey(shared: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, undefined, HKDF_INFO, 32);
}

/**
 * Encrypts `plaintext` to the keystore public key. The output is safe to publish on chain; the
 * input is secret and must never be logged.
 */
export function keystoreEncrypt(
  pubkeyHex: string,
  plaintext: Uint8Array,
  ephemeralSecret: Uint8Array = x25519.utils.randomSecretKey(),
  nonce: Uint8Array = randomBytes(12),
): Uint8Array {
  const recipient = fromHex(pubkeyHex);
  if (recipient.length !== 32) throw new Error("keystore key is not 32 bytes");
  const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
  const key = eciesKey(x25519.getSharedSecret(ephemeralSecret, recipient));
  const sealed = chacha20poly1305(key, nonce).encrypt(plaintext);
  key.fill(0);
  const out = new Uint8Array(1 + 32 + 12 + sealed.length);
  out[0] = ECIES_VERSION;
  out.set(ephemeralPublic, 1);
  out.set(nonce, 33);
  out.set(sealed, 45);
  return out;
}

/** The keystore's side, used by tests to prove the format round trips. */
export function keystoreDecrypt(
  secretKey: Uint8Array,
  wire: Uint8Array,
): Uint8Array {
  if (wire[0] !== ECIES_VERSION || wire.length < 61)
    throw new Error("not ECIES v1");
  const key = eciesKey(x25519.getSharedSecret(secretKey, wire.slice(1, 33)));
  return chacha20poly1305(key, wire.slice(33, 45)).decrypt(wire.slice(45));
}

/**
 * Builds the encrypted secrets blob for K. Takes K, returns only ciphertext (base64); K and the
 * JSON holding it are never returned, logged or stored.
 */
export function encryptK(pubkeyHex: string, key: Uint8Array): string {
  const json = new TextEncoder().encode(
    JSON.stringify({ [SECRET_ENV_NAME]: toHex(key) }),
  );
  try {
    return toBase64(keystoreEncrypt(pubkeyHex, json));
  } finally {
    json.fill(0);
  }
}

/**
 * Asks the OutLayer coordinator for the keystore key for this project and owner. Sends the
 * variable name with an empty value: the keystore only checks names.
 */
export async function fetchKeystorePubkey(
  apiBase: string,
  projectId: string,
  owner: string,
): Promise<string> {
  const response = await fetch(`${apiBase}/secrets/pubkey`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accessor: { type: "Project", project_id: projectId },
      owner,
      secrets_json: JSON.stringify({ [SECRET_ENV_NAME]: "" }),
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    pubkey?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || typeof body?.pubkey !== "string") {
    throw new Error(
      `OutLayer keystore refused the key request (HTTP ${response.status})`,
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(body.pubkey))
    throw new Error("OutLayer keystore returned a malformed key");
  return body.pubkey.toLowerCase();
}

export interface StoreSecretsArgs {
  accessor: ReturnType<typeof projectAccessor>;
  profile: string;
  encrypted_secrets_base64: string;
  access: ReturnType<typeof kAccessCondition>;
  vault_id: null;
}

export function storeSecretsArgs(
  projectId: string,
  profile: string,
  encryptedBase64: string,
  graderMeasurement: string,
  contractId: string,
): StoreSecretsArgs {
  return {
    accessor: projectAccessor(projectId),
    profile,
    encrypted_secrets_base64: encryptedBase64,
    access: kAccessCondition(graderMeasurement, contractId),
    // Default OutLayer master; near-sdk needs the field present.
    vault_id: null,
  };
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}
