import { describe, expect, it } from "vitest";
import {
  benchmarkFolder,
  encodeFastfsFile,
  fastfsUrl,
  isSafeRelativePath,
} from "./fastfs";

describe("fastfs", () => {
  it("encodes SimpleFastfs with Borsh", () => {
    const bytes = encodeFastfsFile({
      relativePath: "a/b.bin",
      mimeType: "x/y",
      content: Uint8Array.of(9, 8),
    });
    expect(Array.from(bytes)).toEqual([
      0, // FastfsData::Simple
      7,
      0,
      0,
      0,
      ...new TextEncoder().encode("a/b.bin"),
      1, // Some
      3,
      0,
      0,
      0,
      ...new TextEncoder().encode("x/y"),
      2,
      0,
      0,
      0,
      9,
      8,
    ]);
  });

  it("refuses unsafe paths, empty MIME types and large files", () => {
    for (const path of ["/a", "a//b", "../a", "a/./b", "a b", ""]) {
      expect(isSafeRelativePath(path)).toBe(false);
    }
    expect(isSafeRelativePath("blindmark/bm3/v1/shard-0000.bin")).toBe(true);
    const content = new Uint8Array(1);
    expect(() =>
      encodeFastfsFile({ relativePath: "../x", mimeType: "a/b", content }),
    ).toThrow("unsafe");
    expect(() =>
      encodeFastfsFile({ relativePath: "x", mimeType: "", content }),
    ).toThrow("MIME");
    expect(() =>
      encodeFastfsFile({
        relativePath: "x",
        mimeType: "a/b",
        content: new Uint8Array((1 << 20) + 1),
      }),
    ).toThrow("limit");
  });

  it("builds the served URL", () => {
    expect(
      fastfsUrl(
        "test.fastfs.io",
        "alice.testnet",
        "blindmark.testnet",
        `${benchmarkFolder(3, 1)}/protocol.json`,
      ),
    ).toBe(
      "https://test.fastfs.io/alice.testnet/blindmark.testnet/blindmark/bm3/v1/protocol.json",
    );
  });
});
