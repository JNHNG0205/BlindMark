"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  computeBudget,
  evalDeposit,
  formatNear,
  type Backend,
  type Benchmark,
  type Eval,
  type ModelInfo,
  type Usage,
} from "@blindmark/shared";
import { useWallet } from "../../../components/wallet";
import {
  getEval,
  getEvalStorageDeposit,
  getUsage,
  nextEvalId,
} from "../../../lib/rpc";

const POLL_MS = 3000;
const WATCH_MS = 5 * 60_000;

/**
 * Polls ids from `firstCandidate` up for an eval matching this request. Returns its id, or
 * null after WATCH_MS. Only reads; it never sends anything.
 */
async function watchForEval(
  firstCandidate: number,
  match: (evaluation: Eval) => boolean,
): Promise<number | null> {
  const started = Date.now();
  let candidate = firstCandidate;
  while (Date.now() - started < WATCH_MS) {
    const evaluation = await getEval(candidate).catch(() => null);
    if (evaluation) {
      if (match(evaluation)) return evaluation.id;
      candidate += 1;
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return null;
}

export function RequestEval({
  benchmark,
  models,
  backends,
}: {
  benchmark: Benchmark;
  models: ModelInfo[];
  backends: Backend[];
}) {
  const router = useRouter();
  const { accountId, call, signIn } = useWallet();
  const activeModels = models.filter((m) => m.active);
  // Part 2 backends are rejected by the contract until Part 2 lands.
  const activeBackends = backends.filter(
    (b) => b.active && b.kind === "OutLayer",
  );
  const [modelId, setModelId] = useState(activeModels[0]?.id ?? "");
  const [backendId, setBackendId] = useState(activeBackends[0]?.id ?? "");
  const [storage, setStorage] = useState<bigint | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [phase, setPhase] = useState<"idle" | "sending" | "watching">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const shards = benchmark.shard_hashes.length;

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const clock = setInterval(tick, 10_000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    getEvalStorageDeposit(shards).then(
      (s) => setStorage(BigInt(s)),
      () => setStorage(null),
    );
  }, [shards]);

  useEffect(() => {
    if (!modelId) return;
    getUsage(benchmark.id, modelId).then(setUsage, () => setUsage(null));
  }, [benchmark.id, modelId]);

  const deposit =
    storage === null
      ? null
      : evalDeposit(BigInt(benchmark.price), shards, storage);
  const capReached =
    usage !== null && usage.count >= benchmark.max_evals_per_model;
  const cooldownEnds =
    usage === null
      ? null
      : BigInt(usage.last_requested_ns) + BigInt(benchmark.cooldown_ns);
  const coolingDown =
    cooldownEnds !== null &&
    nowMs !== null &&
    cooldownEnds > BigInt(nowMs) * 1_000_000n;

  async function request() {
    if (deposit === null || phase !== "idle") return;
    setPhase("sending");
    setMessage(null);
    let firstCandidate: number;
    try {
      firstCandidate = await nextEvalId();
    } catch (error) {
      setPhase("idle");
      setMessage(`Could not read the contract: ${(error as Error).message}`);
      return;
    }
    // The transaction stays open until OutLayer's worker answers, so do not wait for the
    // wallet: watch get_eval for the new eval instead. Never resend automatically, because
    // that would request (and pay for) a second eval.
    call(
      "request_eval",
      { benchmark_id: benchmark.id, model_id: modelId, backend_id: backendId },
      { deposit, tgas: 300 },
    ).catch((error: Error) => {
      setMessage(
        `The wallet reported: ${error.message}. The request may still have gone through, so ` +
          "this page keeps watching for it. Do not send it again until you have checked " +
          "your account on the explorer.",
      );
    });
    setPhase("watching");
    const found = await watchForEval(
      firstCandidate,
      (e) =>
        e.requester === accountId &&
        e.benchmark_id === benchmark.id &&
        e.model_id === modelId,
    );
    if (found !== null) {
      router.push(`/evals/${found}`);
      return;
    }
    setMessage(
      "No new eval appeared within 5 minutes. Check your account on the explorer before " +
        "trying again.",
    );
  }

  return (
    <section className="card request">
      <h2 className="card-title">Request evaluation</h2>
      {activeModels.length === 0 || activeBackends.length === 0 ? (
        <p className="muted">
          No active model or OutLayer backend is registered.
        </p>
      ) : (
        <>
          <label>
            <span>Model</span>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            >
              {activeModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} (tier {m.tier})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Grader backend</span>
            <select
              value={backendId}
              onChange={(e) => setBackendId(e.target.value)}
            >
              {activeBackends.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id} ({b.measurement.slice(0, 12)}...)
                </option>
              ))}
            </select>
          </label>
          <dl className="facts">
            <dt>Price</dt>
            <dd>
              {formatNear(benchmark.price)} NEAR, paid to the owner only on a
              certificate
            </dd>
            <dt>Compute budget</dt>
            <dd>
              {formatNear(computeBudget(shards))} NEAR for {shards} shards,
              aggregation and 3 retries; unused compute is refunded
            </dd>
            <dt>Storage</dt>
            <dd>
              {storage === null
                ? "loading"
                : `${formatNear(storage, 6)} NEAR, not refunded`}
            </dd>
            <dt>Total deposit</dt>
            <dd>
              <strong>
                {deposit === null
                  ? "loading"
                  : `${formatNear(deposit, 6)} NEAR`}
              </strong>
            </dd>
            <dt>Your usage</dt>
            <dd>
              {usage ? usage.count : 0} of {benchmark.max_evals_per_model}{" "}
              evaluations for this model
              {coolingDown ? ", cooldown still running" : ""}
            </dd>
          </dl>
          <div className="row request-actions">
            {!accountId ? (
              <button onClick={signIn}>Connect wallet to request</button>
            ) : (
              <button
                onClick={() => void request()}
                disabled={
                  phase !== "idle" ||
                  deposit === null ||
                  capReached ||
                  coolingDown
                }
              >
                {phase === "idle"
                  ? "Request evaluation"
                  : phase === "sending"
                    ? "Waiting for wallet"
                    : "Sent, watching for the eval"}
              </button>
            )}
            {capReached && (
              <span className="error">
                Evaluation cap reached for this model.
              </span>
            )}
          </div>
          {message && <p className="notice">{message}</p>}
        </>
      )}
    </section>
  );
}
