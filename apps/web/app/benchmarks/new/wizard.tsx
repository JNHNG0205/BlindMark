"use client";

// Owner upload wizard. Spec: CLAUDE.md sections 5.3, 5.4, 8 and 11.
//
// K and the plaintext items live only in this component's memory. They must never be logged,
// put in a URL, sent to analytics or written to browser storage. K is shown to the owner once
// so they can create the locked OutLayer secret themselves.
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
import { CONTRACT_ID } from "../../../lib/config";
import { getBackends, predictNextBenchmarkId } from "../../../lib/rpc";

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

export function NewBenchmarkWizard() {
  const { accountId, call, signIn } = useWallet();

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
  const [profile, setProfile] = useState("blindmark-v1");

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
  const [shardBase, setShardBase] = useState("");
  const [protocolUri, setProtocolUri] = useState("");
  const [samplesUri, setSamplesUri] = useState("");
  const [hostCheck, setHostCheck] = useState<string[] | null>(null);
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
    setHostCheck(null);
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

  const shardUris = built
    ? built.encrypted.shards.map((s) =>
        joinUrl(shardBase, shardFileName(s.shard_index)),
      )
    : [];
  const grader = backends.find((b) => b.id === graderBackend);
  const accessCondition = grader
    ? {
        Logic: {
          operator: "And",
          conditions: [
            { WasmHash: { hash: grader.measurement } },
            {
              Predecessor: {
                condition: { Whitelist: { accounts: [CONTRACT_ID] } },
              },
            },
          ],
        },
      }
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

  async function checkHosting() {
    if (!built) return;
    setHostCheck(["checking..."]);
    const lines = await Promise.all(
      built.encrypted.shards.map(async (s, i) => {
        const uri = shardUris[i]!;
        try {
          const response = await fetch(uri, { cache: "no-store" });
          if (!response.ok) return `FAIL shard ${i}: HTTP ${response.status}`;
          const hash = toHex(
            leafHash(new Uint8Array(await response.arrayBuffer())),
          );
          return hash === s.hash
            ? `PASS shard ${i}`
            : `FAIL shard ${i}: hash differs`;
        } catch {
          return `WARN shard ${i}: could not fetch from the browser (CORS or network)`;
        }
      }),
    );
    try {
      const response = await fetch(protocolUri, { cache: "no-store" });
      const hash = protocolHash(await response.json());
      lines.push(
        hash === built.protocolHash
          ? "PASS protocol"
          : "FAIL protocol: hash differs",
      );
    } catch {
      lines.push(
        "WARN protocol: could not fetch from the browser (CORS or network)",
      );
    }
    setHostCheck(lines);
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
        protocol_uri: protocolUri.trim(),
        shard_uris: shardUris,
        shard_hashes: built.encrypted.shards.map((s) => s.hash),
        item_count: built.encrypted.item_count,
        sample_items_uri: samplesUri.trim() || null,
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
  if (!isHttps(shardBase)) problems.push("an https:// base URL for the shards");
  if (!isHttps(protocolUri)) problems.push("an https:// protocol URI");
  if (samplesUri.trim() && !isHttps(samplesUri))
    problems.push("an https:// sample items URI");
  if (!profile.trim()) problems.push("a secret profile name");
  if (!registerArgs) problems.push("a valid price, cap and cooldown");
  else if (BigInt(registerArgs.price) <= 0n)
    problems.push("a price above zero");
  if (!secretCreated)
    problems.push("confirmation that K is saved in the OutLayer secret");

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
            Upload these files to any public https host that serves them
            unchanged. They hold ciphertext, hashes and the public protocol
            only.
          </p>
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
              value={protocolUri}
              onChange={(e) => setProtocolUri(e.target.value)}
            />
          </label>
          <label>
            <span>Public sample items URI (optional)</span>
            <input
              value={samplesUri}
              onChange={(e) => setSamplesUri(e.target.value)}
            />
          </label>
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
              onClick={() =>
                download(
                  "manifest.json",
                  JSON.stringify(manifest, null, 2) + "\n",
                  "application/json",
                )
              }
            >
              Download manifest.json
            </button>
            <button
              className="secondary"
              disabled={!isHttps(shardBase) || !isHttps(protocolUri)}
              onClick={() => void checkHosting()}
            >
              Check hosted files
            </button>
          </div>
          {hostCheck && <pre>{hostCheck.join("\n")}</pre>}
        </section>
      )}

      {built && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>4. Lock K in OutLayer</h2>
          <p>
            Create an OutLayer secret owned by your account so only the approved
            grader build, called through the BlindMark contract, can read K.
            This page does not create it for you yet [VERIFY: OutLayer API or
            Secrets page].
          </p>
          <label>
            <span>Approved grader backend</span>
            <select
              value={graderBackend}
              onChange={(e) => setGraderBackend(e.target.value)}
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
          <label>
            <span>Secret profile name</span>
            <input
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            />
          </label>
          <dl className="facts">
            <dt>Variable</dt>
            <dd className="mono">BLINDMARK_K</dd>
            <dt>Value</dt>
            <dd>
              {showKey && keyRef.current ? (
                <span className="mono">{toHex(keyRef.current)}</span>
              ) : (
                <button className="secondary" onClick={() => setShowKey(true)}>
                  Reveal K
                </button>
              )}
            </dd>
          </dl>
          {accessCondition && (
            <>
              <p>Access condition:</p>
              <pre>{JSON.stringify(accessCondition, null, 2)}</pre>
            </>
          )}
          <p className="notice">
            K is not saved anywhere by this page. If you leave or reload before
            the secret exists, you must encrypt again. Anyone with K can read
            your items.
          </p>
          <label className="inline">
            <input
              type="checkbox"
              checked={secretCreated}
              onChange={(e) => setSecretCreated(e.target.checked)}
            />
            I created the OutLayer secret with this K, profile and access
            condition.
          </label>
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
