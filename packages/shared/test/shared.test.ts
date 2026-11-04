import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalize,
  canContinueDispatch,
  computeBudget,
  decryptShard,
  encryptBenchmark,
  encryptShard,
  formatNear,
  fromHex,
  leafHash,
  merkleProof,
  merkleRoot,
  parseItemsJsonl,
  parseNear,
  protocolHash,
  rootFromHexLeaves,
  shardPlaintextBytes,
  statisticallyTied,
  toHex,
  verifyProof,
  wilson,
  type ProofStep,
} from "../src/index.js";

interface Vectors {
  merkle: {
    ciphertexts_utf8: string[];
    leaves: string[];
    root: string;
    proofs: ProofStep[][];
  }[];
  jcs: { protocol: unknown; canonical: string; protocol_hash: string }[];
  wilson: {
    k: number;
    n: number;
    score_bps: number;
    ci_low_bps: number;
    ci_high_bps: number;
  }[];
  envelope: {
    key: string;
    nonce: string;
    benchmark_id: number;
    version: number;
    shard_index: number;
    plaintext_utf8: string;
    wire: string;
  }[];
}

const vectors: Vectors = JSON.parse(
  readFileSync(
    new URL(
      "../../../crates/blindmark-types/tests/vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

describe("merkle (shared vectors with Rust)", () => {
  it("matches leaves, roots and proofs", () => {
    for (const c of vectors.merkle) {
      const leaves = c.ciphertexts_utf8.map((t) =>
        leafHash(new TextEncoder().encode(t)),
      );
      expect(leaves.map(toHex)).toEqual(c.leaves);
      expect(toHex(merkleRoot(leaves)!)).toBe(c.root);
      expect(rootFromHexLeaves(c.leaves)).toBe(c.root);
      c.proofs.forEach((expected, i) => {
        const proof = merkleProof(leaves, i)!;
        expect(proof).toEqual(expected);
        expect(verifyProof(leaves[i]!, proof, fromHex(c.root))).toBe(true);
      });
    }
  });

  it("rejects bad input", () => {
    const leaves = ["a", "b"].map((t) => leafHash(new TextEncoder().encode(t)));
    const root = merkleRoot(leaves)!;
    const proof = merkleProof(leaves, 0)!;
    expect(merkleRoot([])).toBeNull();
    expect(merkleProof(leaves, 2)).toBeNull();
    expect(verifyProof(leafHash(new Uint8Array([1])), proof, root)).toBe(false);
    expect(verifyProof(leaves[0]!, [{ ...proof[0]!, side: "L" }], root)).toBe(
      false,
    );
    expect(verifyProof(leaves[0]!, [{ ...proof[0]!, hash: "zz" }], root)).toBe(
      false,
    );
    expect(rootFromHexLeaves(["A".repeat(64)])).toBeNull();
    expect(rootFromHexLeaves([])).toBeNull();
  });
});

describe("JCS and protocol hash", () => {
  it("matches the shared vectors", () => {
    for (const c of vectors.jcs) {
      expect(canonicalize(c.protocol)).toBe(c.canonical);
      expect(protocolHash(c.protocol)).toBe(c.protocol_hash);
    }
  });

  it("serializes 1e-6 as 0.000001 and sorts keys", () => {
    expect(canonicalize({ b: 1e-6, a: [true, null, "x"] })).toBe(
      '{"a":[true,null,"x"],"b":0.000001}',
    );
    expect(canonicalize({ "€": 1, "\r": 2, "1": 3 })).toBe(
      '{"\\r":2,"1":3,"€":1}',
    );
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(Infinity)).toThrow();
    expect(() => canonicalize(new Date())).toThrow();
  });
});

describe("wilson", () => {
  it("matches the spec vector 361/500", () => {
    expect(wilson(361, 500)).toEqual({
      score_bps: 7220,
      ci_low_bps: 6812,
      ci_high_bps: 7595,
    });
  });

  it("matches the shared vectors", () => {
    for (const c of vectors.wilson) {
      const { k, n, ...expected } = c;
      expect(wilson(k, n)).toEqual(expected);
    }
  });

  it("rejects impossible counts", () => {
    expect(() => wilson(1, 0)).toThrow();
    expect(() => wilson(5, 4)).toThrow();
    expect(() => wilson(-1, 4)).toThrow();
  });

  it("labels overlapping intervals as tied", () => {
    expect(
      statisticallyTied(
        { ci_low_bps: 10, ci_high_bps: 20 },
        { ci_low_bps: 20, ci_high_bps: 30 },
      ),
    ).toBe(true);
    expect(
      statisticallyTied(
        { ci_low_bps: 10, ci_high_bps: 19 },
        { ci_low_bps: 20, ci_high_bps: 30 },
      ),
    ).toBe(false);
  });
});

describe("envelope", () => {
  const key = new Uint8Array(32).fill(7);
  const id = { benchmark_id: 7, version: 1, shard_index: 3 };

  it("matches the shared vectors", () => {
    for (const c of vectors.envelope) {
      const shardId = {
        benchmark_id: c.benchmark_id,
        version: c.version,
        shard_index: c.shard_index,
      };
      const wire = encryptShard(
        fromHex(c.key),
        shardId,
        new TextEncoder().encode(c.plaintext_utf8),
        fromHex(c.nonce),
      );
      expect(toHex(wire)).toBe(c.wire);
      expect(
        new TextDecoder().decode(decryptShard(fromHex(c.key), shardId, wire)),
      ).toBe(c.plaintext_utf8);
    }
  });

  it("encodes shard plaintext exactly as the shared vector, so browser shards match Rust's", () => {
    const c = vectors.envelope.find((v) => v.plaintext_utf8.startsWith("{"))!;
    const plaintext = shardPlaintextBytes({
      benchmark_id: c.benchmark_id,
      version: c.version,
      shard_index: c.shard_index,
      items: [],
    });
    expect(new TextDecoder().decode(plaintext)).toBe(c.plaintext_utf8);
    expect(
      toHex(
        encryptShard(
          fromHex(c.key),
          {
            benchmark_id: c.benchmark_id,
            version: c.version,
            shard_index: c.shard_index,
          },
          plaintext,
          fromHex(c.nonce),
        ),
      ),
    ).toBe(c.wire);
  });

  it("round trips and binds the AAD and key", () => {
    const plaintext = new TextEncoder().encode("hello");
    const wire = encryptShard(key, id, plaintext);
    expect(wire[0]).toBe(1);
    expect(wire.length).toBe(1 + 24 + 5 + 16);
    expect(decryptShard(key, id, wire)).toEqual(plaintext);
    expect(() => decryptShard(key, { ...id, shard_index: 4 }, wire)).toThrow();
    expect(() => decryptShard(new Uint8Array(32), id, wire)).toThrow();
    const tampered = wire.slice();
    tampered[30]! ^= 1;
    expect(() => decryptShard(key, id, tampered)).toThrow();
  });

  it("uses a fresh nonce each time", () => {
    const p = new Uint8Array([1, 2, 3]);
    expect(toHex(encryptShard(key, id, p))).not.toBe(
      toHex(encryptShard(key, id, p)),
    );
  });
});

describe("items and shards", () => {
  const line = (i: number) =>
    JSON.stringify({
      id: `t-${i}`,
      prompt: `What is ${i} + 1?`,
      choices: null,
      answer: String(i + 1),
      grading_type: "numeric",
      rubric: null,
    });

  it("parses JSONL and reports errors without content", () => {
    expect(parseItemsJsonl(`${line(1)}\n\n${line(2)}\n`)).toHaveLength(2);
    expect(() => parseItemsJsonl(`${line(1)}\n${line(1)}`)).toThrow(
      "line 2: duplicate id",
    );
    expect(() => parseItemsJsonl("{secret-question")).toThrow(
      /^line 1: not valid JSON$/,
    );
    expect(() =>
      parseItemsJsonl(
        '{"id":"x","prompt":"p","answer":"a","grading_type":"bogus"}',
      ),
    ).toThrow('line 1: invalid or missing "grading_type"');
    expect(() => parseItemsJsonl("")).toThrow("no items found");
  });

  it("encrypts into shards the grader can decrypt and commits to them", () => {
    const items = parseItemsJsonl(
      Array.from({ length: 120 }, (_, i) => line(i)).join("\n"),
    );
    const key = new Uint8Array(32).fill(9);
    const built = encryptBenchmark(items, key, { benchmark_id: 7, version: 1 });
    expect(built.shards.map((s) => s.item_count)).toEqual([50, 50, 20]);
    expect(rootFromHexLeaves(built.shards.map((s) => s.hash))).toBe(
      built.dataset_root,
    );
    const shard = built.shards[2]!;
    const plaintext = decryptShard(
      key,
      { benchmark_id: 7, version: 1, shard_index: 2 },
      shard.ciphertext,
    );
    expect(plaintext).toEqual(
      shardPlaintextBytes({
        benchmark_id: 7,
        version: 1,
        shard_index: 2,
        items: items.slice(100),
      }),
    );
  });

  it("enforces the shard count and size limits", () => {
    const items = parseItemsJsonl(line(1));
    const key = new Uint8Array(32);
    expect(() =>
      encryptBenchmark(items, key, { benchmark_id: 0, version: 1 }, 0),
    ).toThrow();
    const many = parseItemsJsonl(
      Array.from({ length: 65 }, (_, i) => line(i)).join("\n"),
    );
    expect(() =>
      encryptBenchmark(many, key, { benchmark_id: 0, version: 1 }, 1),
    ).toThrow(/1 to 64/);
    const big = [{ ...items[0]!, prompt: "x".repeat(210 * 1024) }];
    expect(() =>
      encryptBenchmark(big, key, { benchmark_id: 0, version: 1 }),
    ).toThrow(/limit/);
  });
});

describe("eval helpers", () => {
  it("computes the compute budget from the spec", () => {
    expect(computeBudget(2)).toBe(6n * 20_000_000_000_000_000_000_000n);
  });

  it("knows when continue_dispatch has something to send", () => {
    expect(
      canContinueDispatch({
        status: "Dispatching",
        retry_shards: [],
        partials: [null],
      }),
    ).toBe(true);
    expect(
      canContinueDispatch({
        status: "Grading",
        retry_shards: [],
        partials: [null, "x"],
      }),
    ).toBe(false);
    expect(
      canContinueDispatch({
        status: "Grading",
        retry_shards: [0],
        partials: [null, "x"],
      }),
    ).toBe(true);
    expect(
      canContinueDispatch({
        status: "Grading",
        retry_shards: [],
        partials: ["x", "y"],
      }),
    ).toBe(true);
    expect(
      canContinueDispatch({
        status: "Aggregating",
        retry_shards: [],
        partials: ["x"],
      }),
    ).toBe(false);
  });

  it("formats and parses NEAR amounts", () => {
    expect(formatNear(10n ** 24n)).toBe("1");
    expect(formatNear("1100000000000000000000000")).toBe("1.1");
    expect(formatNear(0n)).toBe("0");
    expect(parseNear("1.5")).toBe(15n * 10n ** 23n);
    expect(parseNear("0.01")).toBe(10n ** 22n);
    expect(() => parseNear("1e3")).toThrow();
    expect(() => parseNear("-1")).toThrow();
  });
});
