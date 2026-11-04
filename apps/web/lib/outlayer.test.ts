import { x25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { toHex } from "@blindmark/shared";
import {
  encryptK,
  kAccessCondition,
  keystoreDecrypt,
  keystoreEncrypt,
  storeSecretsArgs,
} from "./outlayer";

describe("OutLayer keystore ECIES", () => {
  const keystoreSecret = new Uint8Array(32).fill(5);
  const keystorePub = toHex(x25519.getPublicKey(keystoreSecret));

  it("lays out version, ephemeral key, nonce and sealed text", () => {
    const ephemeral = new Uint8Array(32).fill(1);
    const nonce = new Uint8Array(12).fill(2);
    const wire = keystoreEncrypt(
      keystorePub,
      Uint8Array.of(1, 2, 3),
      ephemeral,
      nonce,
    );
    expect(wire[0]).toBe(1);
    expect(toHex(wire.slice(1, 33))).toBe(
      toHex(x25519.getPublicKey(ephemeral)),
    );
    expect(toHex(wire.slice(33, 45))).toBe(toHex(nonce));
    expect(wire.length).toBe(45 + 3 + 16);
    expect(Array.from(keystoreDecrypt(keystoreSecret, wire))).toEqual([
      1, 2, 3,
    ]);
  });

  it("encrypts K as the BLINDMARK_K variable, readable only with the keystore key", () => {
    const k = new Uint8Array(32).fill(0xab);
    const sealed = encryptK(keystorePub, k);
    const wire = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
    expect(sealed).not.toContain(toHex(k));
    expect(
      JSON.parse(
        new TextDecoder().decode(keystoreDecrypt(keystoreSecret, wire)),
      ),
    ).toEqual({ BLINDMARK_K: toHex(k) });
    expect(() => keystoreDecrypt(new Uint8Array(32).fill(6), wire)).toThrow();
  });

  it("rejects a malformed keystore key", () => {
    expect(() => keystoreEncrypt("abcd", Uint8Array.of(1))).toThrow();
  });
});

describe("store_secrets arguments", () => {
  it("binds the project and the section 8 condition", () => {
    expect(
      storeSecretsArgs(
        "owner.testnet/grader",
        "bm-v1",
        "AAA=",
        "ab".repeat(32),
        "bm.testnet",
      ),
    ).toEqual({
      accessor: { Project: { project_id: "owner.testnet/grader" } },
      profile: "bm-v1",
      encrypted_secrets_base64: "AAA=",
      access: kAccessCondition("ab".repeat(32), "bm.testnet"),
      vault_id: null,
    });
    expect(kAccessCondition("h", "c")).toEqual({
      Logic: {
        operator: "And",
        conditions: [
          { WasmHash: { hash: "h" } },
          { Predecessor: { condition: { Whitelist: { accounts: ["c"] } } } },
        ],
      },
    });
  });
});
