// FastFS upload for public benchmark files (CLAUDE.md section 4: shard storage).
//
// A file is uploaded by sending a function call `__fastdata_fastfs` whose arguments are the
// Borsh-encoded file. No contract implements that method, so the receipt fails on purpose; the
// FastFS indexer reads the file from the transaction arguments and serves it at
// `https://<host>/<signer>/<receiver>/<relative_path>`. The bytes live in the NEAR transaction
// ledger, so anyone can re-derive them.
//
// Only ciphertext and public files may go through here: whatever is uploaded is public forever.
// Never pass K, plaintext items or anything derived from them.

/** One indexer host per network: each CDN host indexes one chain. */
export const FASTFS_HOSTS = {
  testnet: "test.fastfs.io",
  mainnet: "main.fastfs.io",
} as const;

export const FASTFS_METHOD = "__fastdata_fastfs";

/** The OutLayer CLI splits above 1 MiB; our shards are about 200 KiB, so one call per file. */
export const FASTFS_MAX_FILE_BYTES = 1 << 20;

export interface FastfsFile {
  relativePath: string;
  mimeType: string;
  content: Uint8Array;
}

class Writer {
  private parts: Uint8Array[] = [];

  u8(value: number) {
    this.parts.push(Uint8Array.of(value));
  }

  u32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.parts.push(bytes);
  }

  bytes(value: Uint8Array) {
    this.u32(value.length);
    this.parts.push(value);
  }

  string(value: string) {
    this.bytes(new TextEncoder().encode(value));
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

/**
 * Relative paths become URL path segments, so keep them to a safe character set: no leading
 * slash, no `..`, no empty segments.
 */
export function isSafeRelativePath(path: string): boolean {
  return (
    /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(path) &&
    !path.split("/").some((segment) => segment === "." || segment === "..")
  );
}

/**
 * Borsh encoding of `FastfsData::Simple(SimpleFastfs { relative_path, content: Some(
 * FastfsFileContent { mime_type, content }) })`, the format in the FastFS docs and the OutLayer
 * CLI: enum tag u8 0, strings and byte vectors as u32 little-endian length then bytes, `Some` as
 * u8 1.
 */
export function encodeFastfsFile(file: FastfsFile): Uint8Array {
  if (!isSafeRelativePath(file.relativePath)) {
    throw new Error(`unsafe FastFS path: ${file.relativePath}`);
  }
  if (!file.mimeType) throw new Error("FastFS needs a MIME type");
  if (file.content.length > FASTFS_MAX_FILE_BYTES) {
    throw new Error(
      `${file.relativePath} is ${file.content.length} bytes; the limit here is ${FASTFS_MAX_FILE_BYTES}`,
    );
  }
  const w = new Writer();
  w.u8(0); // FastfsData::Simple
  w.string(file.relativePath);
  w.u8(1); // Some(content)
  w.string(file.mimeType);
  w.bytes(file.content);
  return w.finish();
}

export function fastfsUrl(
  host: string,
  signer: string,
  receiver: string,
  relativePath: string,
): string {
  return `https://${host}/${signer}/${receiver}/${relativePath}`;
}

/** Folder for one benchmark version, so files of different benchmarks never collide. */
export function benchmarkFolder(benchmarkId: number, version: number): string {
  return `blindmark/bm${benchmarkId}/v${version}`;
}
