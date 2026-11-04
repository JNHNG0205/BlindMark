"use client";

// Owner upload wizard. Spec: CLAUDE.md sections 5.3, 5.4, 8 and 11.
//
// K and the plaintext items live only in this component's memory. They must never be logged,
// put in a URL, sent to analytics or written to browser storage. K leaves the browser only
// encrypted to the OutLayer keystore key (step 4); the owner may also reveal it to keep a copy.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_ITEMS_PER_SHARD,
  encryptBenchmark,
  generateKey,
  leafHash,
  parseItemsJsonl,
  parseNear,
  protocolHash,
  shardFileName,
  toHex,
  type Backend,
  type EncryptedBenchmark,
  type RegisterBenchmarkArgs,
} from "@blindmark/shared";
import { returnValue, useWallet } from "../../../components/wallet";
import {
  CONTRACT_ID,
  FASTFS_HOST,
  OUTLAYER_API_URL,
  OUTLAYER_CONTRACT_ID,
} from "../../../lib/config";
import {
  benchmarkFolder,
  encodeFastfsFile,
  FASTFS_METHOD,
  fastfsUrl,
  type FastfsFile,
} from "../../../lib/fastfs";
import {
  encryptK,
  fetchKeystorePubkey,
  kAccessCondition,
  projectAccessor,
  SECRET_ENV_NAME,
  storeSecretsArgs,
} from "../../../lib/outlayer";
import { getBackends, predictNextBenchmarkId, viewOn } from "../../../lib/rpc";

const DEFAULT_PROTOCOL = {
  version: 1,
  system_prompt: "You are taking an exam. Reply with only the final answer.",
  prompt_template:
    "{{prompt}}\n{{#choices}}Options:\n{{choices}}{{/choices}}\nAnswer:",
  few_shot: [],
  model_params: { temperature: 0, max_tokens: 256 },
  grading: {
    default_type: "numeric",
    normalize: ["trim", "lowercase", "strip_trailing_period"],
    numeric_tolerance: 1e-6,
    answer_extraction: "last_line",
  },
  metric: "accuracy",
  rules: { attempts_per_item: 1, tools: false },
};

/** Covers the benchmark record for up to 64 shards with long URIs; the contract refunds the rest. */
const REGISTER_DEPOSIT = parseNear("0.25");

interface Built {
  encrypted: EncryptedBenchmark;
  benchmarkId: number;
  version: number;
  protocolHash: string;
  protocolText: string;
}

function download(name: string, data: Uint8Array | string, type: string) {
  const blob = new Blob([typeof data === "string" ? data : data.slice()], {
    type,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function joinUrl(base: string, name: string): string {
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function isHttps(text: string): boolean {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

type LineStatus = "PASS" | "FAIL" | "WAIT";

interface HostLine {
  status: LineStatus;
  text: string;
}

interface HostCheck {
  /** The URIs this result is for; a result for other URIs does not count. */
  key: string;
  lines: HostLine[];
  running: boolean;
}

/** FastFS serves a file once its indexer has seen the transaction, usually within seconds. */
const HOST_CHECK_ATTEMPTS = 12;
const HOST_CHECK_GAP_MS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Profiles allow letters, digits, dashes and underscores (OutLayer contract). */
function isProfileName(text: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(text);
}

/** One profile per benchmark version, so a new benchmark never replaces an older one's K. */
function defaultProfile(benchmarkId: number, version: number): string {
  return `blindmark-bm${benchmarkId}-v${version}`;
}

export function NewBenchmarkWizard() {
  const { accountId, call, sendTransactions, signIn } = useWallet();

  // Public metadata.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1");
  const [price, setPrice] = useState("1");
  const [itemsPerShard, setItemsPerShard] = useState(
    String(DEFAULT_ITEMS_PER_SHARD),
  );
  const [maxEvals, setMaxEvals] = useState("3");
  const [cooldownHours, setCooldownHours] = useState("24");
  const [protocolText, setProtocolText] = useState(
    JSON.stringify(DEFAULT_PROTOCOL, null, 2),
  );
  const [profile, setProfile] = useState("");

  // Private: the items file, K and the build stay in memory only.
  const [items, setItems] = useState<ReturnType<typeof parseItemsJsonl> | null>(
    null,
  );
  const [itemsError, setItemsError] = useState<string | null>(null);
  const keyRef = useRef<Uint8Array | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  // Hosting and registration.
  const [backends, setBackends] = useState<Backend[]>([]);
  const [graderBackend, setGraderBackend] = useState("");
  const [hosting, setHosting] = useState<"fastfs" | "manual">("fastfs");
  const [shardBase, setShardBase] = useState("");
  const [manualProtocolUri, setManualProtocolUri] = useState("");
  const [manualSamplesUri, setManualSamplesUri] = useState("");
  // Public sample items: the owner picks a file that is published as is.
  const [samplesFile, setSamplesFile] = useState<Uint8Array | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [hostCheck, setHostCheck] = useState<HostCheck | null>(null);
  const checkRun = useRef(0);
  // The ciphertext this page stored in OutLayer, compared with what the contract holds.
  const [secretStatus, setSecretStatus] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [storingSecret, setStoringSecret] = useState(false);
  const [secretCreated, setSecretCreated] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    text: string;
    id?: number;
  } | null>(null);

  useEffect(() => {
    getBackends().then(
      (all) => {
        const usable = all.filter((b) => b.active && b.kind === "OutLayer");
        setBackends(usable);
        setGraderBackend((current) => current || usable[0]?.id || "");
      },
      () => setBackends([]),
    );
  }, []);

  // Drop K and the build when the page goes away.
  useEffect(
    () => () => {
      keyRef.current?.fill(0);
      keyRef.current = null;
    },
    [],
  );

  const protocol = useMemo(() => {
    try {
      const value: unknown = JSON.parse(protocolText);
      return { value, hash: protocolHash(value), error: null };
    } catch (error) {
      return { value: null, hash: null, error: (error as Error).message };
    }
  }, [protocolText]);

  async function onItemsFile(file: File | undefined) {
    setItems(null);
    setItemsError(null);
    reset();
    if (!file) return;
    try {
      setItems(parseItemsJsonl(await file.text()));
    } catch (error) {
      // Messages from parseItemsJsonl name lines and fields only, never item content.
      setItemsError((error as Error).message);
    }
  }

  function reset() {
    keyRef.current?.fill(0);
    keyRef.current = null;
    setBuilt(null);
    setShowKey(false);
    setSecretCreated(false);
    setSecretStatus(null);
    setHostCheck(null);
    setUploadNote(null);
    setResult(null);
  }

  async function build() {
    reset();
    setBuildError(null);
    if (!items || !protocol.hash) return;
    try {
      const v = Number(version);
      if (!Number.isInteger(v) || v < 0)
        throw new Error("version must be a whole number");
      // The shard AAD binds the benchmark id, which the contract assigns on registration.
      // This is a guess: if another benchmark registers first, the shards are bound to the
      // wrong id and must be rebuilt (see the check after registration).
      const benchmarkId = await predictNextBenchmarkId();
      const key = generateKey();
      const encrypted = encryptBenchmark(
        items,
        key,
        { benchmark_id: benchmarkId, version: v },
        Number(itemsPerShard),
      );
      keyRef.current = key;
      setProfile(defaultProfile(benchmarkId, v));
      setBuilt({
        encrypted,
        benchmarkId,
        version: v,
        protocolHash: protocol.hash,
        protocolText: JSON.stringify(protocol.value, null, 2) + "\n",
      });
    } catch (error) {
      setBuildError((error as Error).message);
    }
  }

  // FastFS URLs name the uploader, so they exist only once a wallet is connected.
  const folder = built ? benchmarkFolder(built.benchmarkId, built.version) : "";
  const fastfsUri = (name: string) =>
    built && accountId
      ? fastfsUrl(FASTFS_HOST, accountId, CONTRACT_ID, `${folder}/${name}`)
      : "";
  const shardUris = built
    ? built.encrypted.shards.map((s) =>
        hosting === "fastfs"
          ? fastfsUri(shardFileName(s.shard_index))
          : joinUrl(shardBase, shardFileName(s.shard_index)),
      )
    : [];
  const protocolUri =
    hosting === "fastfs"
      ? fastfsUri("protocol.json")
      : manualProtocolUri.trim();
  const samplesUri =
    hosting === "fastfs"
      ? samplesFile
        ? fastfsUri("samples.jsonl")
        : ""
      : manualSamplesUri.trim();
  const hostKey = JSON.stringify([shardUris, protocolUri, samplesUri]);
  const hostedOk =
    hostCheck !== null &&
    hostCheck.key === hostKey &&
    !hostCheck.running &&
    hostCheck.lines.every((l) => l.status === "PASS");

  const grader = backends.find((b) => b.id === graderBackend);
  const accessCondition = grader
    ? kAccessCondition(grader.measurement, CONTRACT_ID)
    : null;

  const manifest = built && {
    benchmark_id_expected: built.benchmarkId,
    version: built.version,
    dataset_root: built.encrypted.dataset_root,
    protocol_hash: built.protocolHash,
    item_count: built.encrypted.item_count,
    shards: built.encrypted.shards.map((s, i) => ({
      shard_index: s.shard_index,
      file: shardFileName(s.shard_index),
      uri: shardUris[i],
      hash: s.hash,
      bytes: s.ciphertext.length,
    })),
  };

  const manifestText = manifest ? JSON.stringify(manifest, null, 2) + "\n" : "";

  /**
   * Fetches every public file back and re-hashes it (section 5.4 leaf hash for shards, section
   * 5.2 protocol hash). Registration stays blocked until every line is PASS for the current
   * URIs. A missing file is retried, because FastFS serves a file only after indexing it; a
   * wrong hash fails at once.
   */
  async function checkHosting(attempts = 1) {
    if (!built) return;
    const run = ++checkRun.current;
    const key = hostKey;
    const targets: {
      label: string;
      uri: string;
      verify: (bytes: Uint8Array) => boolean;
    }[] = built.encrypted.shards.map((s, i) => ({
      label: `shard ${i}`,
      uri: shardUris[i]!,
      verify: (bytes) => toHex(leafHash(bytes)) === s.hash,
    }));
    targets.push({
      label: "protocol",
      uri: protocolUri,
      verify: (bytes) => {
        try {
          return (
            protocolHash(JSON.parse(new TextDecoder().decode(bytes))) ===
            built.protocolHash
          );
        } catch {
          return false;
        }
      },
    });
    if (samplesUri) {
      targets.push({
        label: "samples",
        uri: samplesUri,
        verify: (bytes) =>
          hosting === "manual" ||
          (samplesFile !== null && toHex(bytes) === toHex(samplesFile)),
      });
    }

    const checkOne = async (t: (typeof targets)[number]): Promise<HostLine> => {
      if (!isHttps(t.uri))
        return { status: "FAIL", text: `${t.label}: not an https:// URL` };
      try {
        const response = await fetch(t.uri, { cache: "no-store" });
        if (!response.ok)
          return {
            status: "WAIT",
            text: `${t.label}: HTTP ${response.status} from ${t.uri}`,
          };
        return t.verify(new Uint8Array(await response.arrayBuffer()))
          ? { status: "PASS", text: `${t.label}: hash matches` }
          : { status: "FAIL", text: `${t.label}: content or hash differs` };
      } catch {
        return {
          status: "WAIT",
          text: `${t.label}: could not fetch from the browser (CORS or network)`,
        };
      }
    };

    let lines: HostLine[] = targets.map((t) => ({
      status: "WAIT",
      text: `${t.label}: checking`,
    }));
    setHostCheck({ key, lines, running: true });
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(HOST_CHECK_GAP_MS);
      lines = await Promise.all(
        targets.map((t, i) =>
          lines[i]!.status === "WAIT" ? checkOne(t) : lines[i]!,
        ),
      );
      if (run !== checkRun.current) return; // a newer check replaced this one
      const pending = lines.some((l) => l.status === "WAIT");
      if (!pending || attempt === attempts) break;
      setHostCheck({ key, lines, running: true });
    }
    // Whatever is still missing after the last attempt is a failure.
    lines = lines.map((l) =>
      l.status === "WAIT" ? { status: "FAIL", text: l.text } : l,
    );
    setHostCheck({ key, lines, running: false });
  }

  /**
   * Publishes the ciphertext shards and public files to FastFS: one wallet-signed call per file.
   * Only ciphertext and public files are passed here; K and plaintext items never are.
   */
  async function uploadToFastfs() {
    if (!built || !accountId || uploading) return;
    setUploading(true);
    setUploadNote(null);
    const utf8 = (text: string) => new TextEncoder().encode(text);
    const files: FastfsFile[] = [
      ...built.encrypted.shards.map((s) => ({
        relativePath: `${folder}/${shardFileName(s.shard_index)}`,
        mimeType: "application/octet-stream",
        content: s.ciphertext,
      })),
      {
        relativePath: `${folder}/protocol.json`,
        mimeType: "application/json",
        content: utf8(built.protocolText),
      },
      {
        relativePath: `${folder}/manifest.json`,
        mimeType: "application/json",
        content: utf8(manifestText),
      },
    ];
    if (samplesFile) {
      files.push({
        relativePath: `${folder}/samples.jsonl`,
        mimeType: "application/x-ndjson",
        content: samplesFile,
      });
    }
    try {
      const txs = files.map((f) => ({
        receiverId: CONTRACT_ID,
        method: FASTFS_METHOD,
        args: encodeFastfsFile(f),
        // The call fails on chain by design (no contract has this method); the indexer reads
        // the arguments. 1 Tgas keeps the failure cheap.
        tgas: 1,
      }));
      await sendTransactions(txs);
    } catch (error) {
      setUploadNote(
        `The wallet reported: ${(error as Error).message}. FastFS calls fail on chain by ` +
          "design, so this can be normal; the check below decides.",
      );
    } finally {
      setUploading(false);
    }
    await checkHosting(HOST_CHECK_ATTEMPTS);
  }

  /**
   * Stores K in OutLayer, encrypted in this browser to the keystore key, under the section 8
   * access condition. Never logs or returns K; only the ciphertext leaves the page.
   */
  async function createSecret() {
    const key = keyRef.current;
    const projectId = grader?.outlayer_project;
    if (!built || !accountId || !grader || !projectId || !key) return;
    if (storingSecret) return;
    setStoringSecret(true);
    setSecretStatus(null);
    setSecretCreated(false);
    const prof = profile.trim();
    const lookup = {
      accessor: projectAccessor(projectId),
      profile: prof,
      owner: accountId,
    };
    try {
      const pubkey = await fetchKeystorePubkey(
        OUTLAYER_API_URL,
        projectId,
        accountId,
      );
      const sealed = encryptK(pubkey, key);
      const args = storeSecretsArgs(
        projectId,
        prof,
        sealed,
        grader.measurement,
        CONTRACT_ID,
      );
      const deposit = await viewOn<string>(
        OUTLAYER_CONTRACT_ID,
        "estimate_storage_cost",
        {
          ...lookup,
          encrypted_secrets_base64: sealed,
          access: args.access,
          vault_id: null,
        },
      );
      let walletError: string | null = null;
      try {
        await call("store_secrets", args, {
          receiverId: OUTLAYER_CONTRACT_ID,
          deposit: BigInt(deposit),
          tgas: 50,
        });
      } catch (error) {
        walletError = (error as Error).message;
      }
      // The contract is the source of truth: it must hold exactly this ciphertext.
      const stored = await viewOn<{ encrypted_secrets?: string } | null>(
        OUTLAYER_CONTRACT_ID,
        "get_secrets",
        lookup,
      );
      if (stored?.encrypted_secrets === sealed) {
        setSecretCreated(true);
        setSecretStatus({
          ok: true,
          text: `Stored in ${OUTLAYER_CONTRACT_ID} as profile ${prof} for project ${projectId}.`,
        });
      } else {
        setSecretStatus({
          ok: false,
          text: walletError
            ? `Not stored: ${walletError}`
            : `${OUTLAYER_CONTRACT_ID} does not hold this ciphertext yet. Try again in a moment.`,
        });
      }
    } catch (error) {
      setSecretStatus({
        ok: false,
        text: `Could not create the secret: ${(error as Error).message}`,
      });
    } finally {
      setStoringSecret(false);
    }
  }

  const registerArgs: RegisterBenchmarkArgs | null = (() => {
    if (!built || !accountId) return null;
    try {
      return {
        version: built.version,
        title: title.trim(),
        description: description.trim(),
        grading_type: String(
          (protocol.value as { grading?: { default_type?: string } }).grading
            ?.default_type ?? "mixed",
        ),
        dataset_root: built.encrypted.dataset_root,
        protocol_hash: built.protocolHash,
        protocol_uri: protocolUri,
        shard_uris: shardUris,
        shard_hashes: built.encrypted.shards.map((s) => s.hash),
        item_count: built.encrypted.item_count,
        sample_items_uri: samplesUri || null,
        price: parseNear(price).toString(),
        secret_ref: { owner: accountId, profile: profile.trim() },
        max_evals_per_model: Number(maxEvals),
        cooldown_ns: (
          BigInt(Math.round(Number(cooldownHours) * 3600)) *
          10n ** 9n
        ).toString(),
      };
    } catch {
      return null;
    }
  })();

  const problems: string[] = [];
  if (!title.trim()) problems.push("a title");
  if (!hostedOk) problems.push("every hosted file to pass the check in step 3");
  if (!isProfileName(profile.trim()))
    problems.push("a secret profile name (letters, digits, - and _)");
  if (!registerArgs) problems.push("a valid price, cap and cooldown");
  else if (BigInt(registerArgs.price) <= 0n)
    problems.push("a price above zero");
  if (!secretCreated) problems.push("K stored in the OutLayer secret (step 4)");

  async function register() {
    if (!registerArgs || !built || registering) return;
    setRegistering(true);
    setResult(null);
    try {
      const outcome = await call(
        "register_benchmark",
        { args: registerArgs },
        { deposit: REGISTER_DEPOSIT, tgas: 100 },
      );
      const id = returnValue(outcome);
      if (typeof id !== "number") {
        setResult({
          ok: false,
          text:
            `The wallet gave no result. Check the benchmark list; the shards were encrypted ` +
            `for id ${built.benchmarkId}.`,
        });
      } else if (id !== built.benchmarkId) {
        setResult({
          ok: false,
          id,
          text:
            `Registered as benchmark ${id}, but the shards were encrypted for id ` +
            `${built.benchmarkId}, so the grader cannot decrypt them. Retire benchmark ${id} ` +
            "and run this wizard again.",
        });
      } else {
        setResult({ ok: true, id, text: `Registered as benchmark ${id}.` });
      }
    } catch (error) {
      setResult({
        ok: false,
        text: `Registration failed: ${(error as Error).message}`,
      });
    } finally {
      setRegistering(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>1. Describe it</h2>
        <label>
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          <span>Description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="row">
          <label>
            <span>Version</span>
            <input
              value={version}
              onChange={(e) => {
                setVersion(e.target.value);
                reset();
              }}
            />
          </label>
          <label>
            <span>Price per eval (NEAR)</span>
            <input value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label>
            <span>Evals per model</span>
            <input
              value={maxEvals}
              onChange={(e) => setMaxEvals(e.target.value)}
            />
          </label>
          <label>
            <span>Cooldown (hours)</span>
            <input
              value={cooldownHours}
              onChange={(e) => setCooldownHours(e.target.value)}
            />
          </label>
        </div>
        <label>
          <span>Protocol (public)</span>
          <textarea
            rows={12}
            value={protocolText}
            onChange={(e) => {
              setProtocolText(e.target.value);
              reset();
            }}
          />
        </label>
        {protocol.error ? (
          <p className="error">Protocol is not valid JSON: {protocol.error}</p>
        ) : (
          <p className="muted mono">protocol_hash {protocol.hash}</p>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>2. Encrypt the items in this browser</h2>
        <label>
          <span>Items (JSONL, one item per line; stays on this device)</span>
          <input
            type="file"
            accept=".jsonl,.json,.txt"
            onChange={(e) => void onItemsFile(e.target.files?.[0])}
          />
        </label>
        {itemsError && <p className="error">{itemsError}</p>}
        {items && <p>{items.length} items parsed.</p>}
        <label>
          <span>Items per shard</span>
          <input
            value={itemsPerShard}
            onChange={(e) => {
              setItemsPerShard(e.target.value);
              reset();
            }}
          />
        </label>
        <button
          disabled={!items || !protocol.hash}
          onClick={() => void build()}
        >
          Generate K and encrypt
        </button>
        {buildError && <p className="error">{buildError}</p>}
        {built && (
          <dl className="facts" style={{ marginTop: 12 }}>
            <dt>Shards</dt>
            <dd>
              {built.encrypted.shards.length} (
              {built.encrypted.shards.map((s) => s.item_count).join(", ")}{" "}
              items)
            </dd>
            <dt>Dataset root</dt>
            <dd className="mono">{built.encrypted.dataset_root}</dd>
            <dt>Encrypted for</dt>
            <dd>
              benchmark id {built.benchmarkId}, version {built.version} (the
              next free id right now)
            </dd>
          </dl>
        )}
      </section>

      {built && manifest && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>3. Host the public files</h2>
          <p>
            These files hold ciphertext, hashes and the public protocol only.
            Every file is fetched back and re-hashed before you can register.
          </p>
          <div className="row">
            <label className="inline">
              <input
                type="radio"
                name="hosting"
                checked={hosting === "fastfs"}
                onChange={() => setHosting("fastfs")}
              />
              Upload to FastFS with your wallet
            </label>
            <label className="inline">
              <input
                type="radio"
                name="hosting"
                checked={hosting === "manual"}
                onChange={() => setHosting("manual")}
              />
              Host them myself
            </label>
          </div>

          {hosting === "fastfs" ? (
            <>
              <p className="muted">
                One wallet transaction per file (
                {built.encrypted.shards.length + 2 + (samplesFile ? 1 : 0)} in
                all). Each call fails on chain by design: FastFS reads the file
                from the transaction and serves it at{" "}
                <span className="mono">
                  https://{FASTFS_HOST}/&lt;you&gt;/{CONTRACT_ID}/{folder}/
                </span>
                . Uploads are public and permanent.
              </p>
              <label>
                <span>
                  Public sample items (optional; published exactly as chosen, so
                  never pick the private file)
                </span>
                <input
                  type="file"
                  accept=".jsonl,.json,.txt"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) setSamplesFile(null);
                    else
                      void file
                        .arrayBuffer()
                        .then((b) => setSamplesFile(new Uint8Array(b)));
                  }}
                />
              </label>
              {!accountId ? (
                <button onClick={signIn}>Connect wallet to upload</button>
              ) : (
                <button
                  disabled={uploading || hostCheck?.running}
                  onClick={() => void uploadToFastfs()}
                >
                  {uploading ? "Waiting for wallet" : "Upload with wallet"}
                </button>
              )}
              {uploadNote && <p className="muted">{uploadNote}</p>}
            </>
          ) : (
            <>
              <label>
                <span>Base URL the shard files will be served from</span>
                <input
                  placeholder="https://example.com/bm/v1"
                  value={shardBase}
                  onChange={(e) => setShardBase(e.target.value)}
                />
              </label>
              <label>
                <span>Protocol URI</span>
                <input
                  placeholder="https://example.com/bm/v1/protocol.json"
                  value={manualProtocolUri}
                  onChange={(e) => setManualProtocolUri(e.target.value)}
                />
              </label>
              <label>
                <span>Public sample items URI (optional)</span>
                <input
                  value={manualSamplesUri}
                  onChange={(e) => setManualSamplesUri(e.target.value)}
                />
              </label>
            </>
          )}

          <div className="row">
            <button
              className="secondary"
              onClick={() =>
                built.encrypted.shards.forEach((s) =>
                  download(
                    shardFileName(s.shard_index),
                    s.ciphertext,
                    "application/octet-stream",
                  ),
                )
              }
            >
              Download {built.encrypted.shards.length} shard files
            </button>
            <button
              className="secondary"
              onClick={() =>
                download(
                  "protocol.json",
                  built.protocolText,
                  "application/json",
                )
              }
            >
              Download protocol.json
            </button>
            <button
              className="secondary"
              disabled={!manifestText}
              onClick={() =>
                download("manifest.json", manifestText, "application/json")
              }
            >
              Download manifest.json
            </button>
            <button
              className="secondary"
              disabled={
                hostCheck?.running ||
                !shardUris.every(isHttps) ||
                !isHttps(protocolUri)
              }
              onClick={() => void checkHosting()}
            >
              Check hosted files
            </button>
          </div>
          {hostCheck && hostCheck.key === hostKey && (
            <pre>
              {hostCheck.lines
                .map((l) => `${l.status.padEnd(4)} ${l.text}`)
                .join("\n")}
              {hostCheck.running ? "\nchecking again in a few seconds..." : ""}
            </pre>
          )}
        </section>
      )}

      {built && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>4. Lock K in OutLayer</h2>
          <p>
            Stores K as an OutLayer secret owned by your account, so only the
            approved grader build, called through the BlindMark contract, can
            read it. K is encrypted in this browser to the OutLayer keystore
            key; only that ciphertext is sent.
          </p>
          <label>
            <span>Approved grader backend</span>
            <select
              value={graderBackend}
              onChange={(e) => {
                setGraderBackend(e.target.value);
                setSecretCreated(false);
                setSecretStatus(null);
              }}
            >
              {backends.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id}
                </option>
              ))}
            </select>
          </label>
          {backends.length === 0 && (
            <p className="error">No active OutLayer backend is registered.</p>
          )}
          {grader && !grader.outlayer_project && (
            <p className="error">
              Backend {grader.id} names no OutLayer project, so the secret
              cannot be bound to it.
            </p>
          )}
          <label>
            <span>Secret profile name (one per benchmark version)</span>
            <input
              value={profile}
              onChange={(e) => {
                setProfile(e.target.value);
                setSecretCreated(false);
                setSecretStatus(null);
              }}
            />
          </label>
          <dl className="facts">
            <dt>Project</dt>
            <dd className="mono">{grader?.outlayer_project ?? "none"}</dd>
            <dt>Variable</dt>
            <dd className="mono">{SECRET_ENV_NAME}</dd>
          </dl>
          {accessCondition && (
            <>
              <p>Access condition:</p>
              <pre>{JSON.stringify(accessCondition, null, 2)}</pre>
            </>
          )}
          {!accountId ? (
            <button onClick={signIn}>Connect wallet</button>
          ) : (
            <button
              disabled={
                storingSecret ||
                !grader?.outlayer_project ||
                !isProfileName(profile.trim())
              }
              onClick={() => void createSecret()}
            >
              {storingSecret
                ? "Waiting for wallet"
                : `Store K in ${OUTLAYER_CONTRACT_ID}`}
            </button>
          )}
          {secretStatus && (
            <p className={secretStatus.ok ? "" : "error"}>
              {secretStatus.text}
            </p>
          )}
          <p className="notice">
            K is not saved anywhere by this page. If you leave or reload before
            registering, you must encrypt again. Storing replaces any secret
            with the same project, profile and owner. Anyone with K can read
            your items.
          </p>
          <details>
            <summary>Keep a copy of K, or create the secret yourself</summary>
            <p>
              Reveal K only to store it somewhere safe, or to create the secret
              on the OutLayer Secrets page with the project, profile, variable
              and access condition above.
            </p>
            <dl className="facts">
              <dt>Value</dt>
              <dd>
                {showKey && keyRef.current ? (
                  <span className="mono">{toHex(keyRef.current)}</span>
                ) : (
                  <button
                    className="secondary"
                    onClick={() => setShowKey(true)}
                  >
                    Reveal K
                  </button>
                )}
              </dd>
            </dl>
            <label className="inline">
              <input
                type="checkbox"
                checked={secretCreated}
                onChange={(e) => setSecretCreated(e.target.checked)}
              />
              I created the OutLayer secret myself with this K, project, profile
              and access condition.
            </label>
          </details>
        </section>
      )}

      {built && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>5. Register on NEAR</h2>
          {!accountId ? (
            <button onClick={signIn}>Connect wallet</button>
          ) : (
            <>
              <p>
                Registers as <span className="mono">{accountId}</span>,
                attaching 0.25 NEAR for storage; the contract refunds what it
                does not use.
              </p>
              {problems.length > 0 && (
                <p className="muted">Still needed: {problems.join(", ")}.</p>
              )}
              <button
                disabled={problems.length > 0 || registering}
                onClick={() => void register()}
              >
                {registering ? "Waiting for wallet" : "Register benchmark"}
              </button>
            </>
          )}
          {result && (
            <p className={result.ok ? "" : "error"}>
              {result.text}{" "}
              {result.id !== undefined && (
                <Link href={`/benchmarks/${result.id}`}>Open it</Link>
              )}
            </p>
          )}
        </section>
      )}
    </>
  );
}
