"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { canContinueDispatch, formatNear, type Eval } from "@blindmark/shared";
import { useWallet } from "../../../components/wallet";
import { formatDate, nsToDate } from "../../../lib/format";
import { getEval } from "../../../lib/rpc";

const POLL_MS = 4000;
/** After a manual send, wait this long before offering the button again. */
const RESEND_PAUSE_MS = 20_000;

const STEPS = ["Dispatching", "Grading", "Aggregating", "Certified"] as const;

export function EvalStatusView({ evalId }: { evalId: number }) {
  const { accountId, call, signIn } = useWallet();
  const [evaluation, setEvaluation] = useState<Eval | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const next = await getEval(evalId);
        if (stopped) return;
        setEvaluation(next);
        setError(null);
        if (next && (next.status === "Certified" || next.status === "Refunded"))
          return;
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) setTimeout(poll, POLL_MS);
    }
    void poll();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stopped = true;
      clearInterval(clock);
    };
  }, [evalId]);

  if (evaluation === undefined)
    return <p className="muted">Loading{error ? `: ${error}` : ""}</p>;
  if (evaluation === null) return <p>No evaluation with id {evalId}.</p>;

  const shards = evaluation.partials.length;
  const graded = evaluation.partials.filter((p) => p !== null).length;
  const deadline = nsToDate(evaluation.deadline_ns).getTime();
  const expired = now > deadline;
  const canContinue = canContinueDispatch(evaluation) && !expired;
  const canRefund =
    evaluation.status === "Failed" ||
    (expired &&
      evaluation.status !== "Certified" &&
      evaluation.status !== "Refunded");
  const paused = now - lastSent < RESEND_PAUSE_MS;

  /**
   * Sent by a person, once per click, without waiting: the transaction stays open until
   * OutLayer answers. Polling `get_eval` shows the effect.
   */
  function send(method: "continue_dispatch" | "refund_expired") {
    setLastSent(Date.now());
    setNotice(null);
    call(method, { eval_id: evalId }, { tgas: 300 }).catch((e: Error) =>
      setNotice(
        `The wallet reported: ${e.message}. It may still have gone through; watch the status ` +
          "below before sending again.",
      ),
    );
  }

  return (
    <>
      <section className="card">
        <ol className="stepper" aria-label="Progress">
          {STEPS.map((step, i) => {
            const current = STEPS.indexOf(
              evaluation.status as (typeof STEPS)[number],
            );
            const state =
              current > i || evaluation.status === "Certified"
                ? "done"
                : current === i
                  ? "current"
                  : "todo";
            return (
              <li
                key={step}
                className={state}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span className="step-dot" />
                {step}
              </li>
            );
          })}
          {(evaluation.status === "Failed" ||
            evaluation.status === "Refunded") && (
            <li className="stopped">
              <span className="step-dot" />
              {evaluation.status}
            </li>
          )}
        </ol>
        <div className="shard-progress">
          <div className="shard-progress-label">
            <span>Shards graded</span>
            <span className="mono">
              {graded} / {shards}
            </span>
          </div>
          <div className="shard-track" aria-hidden="true">
            {evaluation.partials.map((p, i) => (
              <span
                key={i}
                className={
                  p !== null
                    ? "graded"
                    : evaluation.retry_shards.includes(i)
                      ? "retry"
                      : i < evaluation.next_shard_to_dispatch
                        ? "sent"
                        : ""
                }
              />
            ))}
          </div>
        </div>
        <dl className="facts">
          <dt>Benchmark</dt>
          <dd>
            <Link href={`/benchmarks/${evaluation.benchmark_id}`}>
              {evaluation.benchmark_id}
            </Link>
          </dd>
          <dt>Model</dt>
          <dd className="mono">{evaluation.model_id}</dd>
          <dt>Backend</dt>
          <dd className="mono">{evaluation.backend_id}</dd>
          <dt>Requester</dt>
          <dd className="mono">{evaluation.requester}</dd>
          <dt>Shards graded</dt>
          <dd>
            {graded} of {shards} (sent {evaluation.next_shard_to_dispatch})
            {evaluation.retry_shards.length > 0 &&
              `, lost runs queued for retry: ${evaluation.retry_shards.join(", ")}`}
          </dd>
          <dt>Retries left</dt>
          <dd>{evaluation.retries_left}</dd>
          <dt>Fee in escrow</dt>
          <dd>{formatNear(evaluation.fee)} NEAR</dd>
          <dt>Compute</dt>
          <dd>
            {formatNear(evaluation.compute_spent)} of{" "}
            {formatNear(evaluation.compute_budget)} NEAR sent to OutLayer
          </dd>
          <dt>Deadline</dt>
          <dd>
            {formatDate(evaluation.deadline_ns)}
            {expired ? " (passed)" : ""}
          </dd>
        </dl>
      </section>

      {evaluation.status === "Certified" && (
        <p>
          <Link href={`/certificates/${evalId}`} className="button">
            View the certificate
          </Link>
        </p>
      )}

      {(canContinue || canRefund) && (
        <section className="card">
          {canContinue && (
            <p>
              The contract has runs to send (
              {evaluation.status === "Dispatching"
                ? "unsent shards"
                : evaluation.retry_shards.length > 0
                  ? "lost runs to retry"
                  : "aggregation"}
              ). Anyone can move it along.
            </p>
          )}
          {canRefund && (
            <p>
              {evaluation.status === "Failed"
                ? "This evaluation failed."
                : "The deadline passed."}{" "}
              Anyone can trigger the refund to the requester.
            </p>
          )}
          <div className="row">
            {!accountId ? (
              <button onClick={signIn}>Connect wallet</button>
            ) : (
              <>
                {canContinue && (
                  <button
                    disabled={paused}
                    onClick={() => send("continue_dispatch")}
                  >
                    {paused ? "Sent, watching" : "Continue dispatch"}
                  </button>
                )}
                {canRefund && (
                  <button
                    disabled={paused}
                    onClick={() => send("refund_expired")}
                  >
                    {paused ? "Sent, watching" : "Refund"}
                  </button>
                )}
              </>
            )}
          </div>
          {notice && <p className="notice">{notice}</p>}
        </section>
      )}
      {error && <p className="error">Polling error: {error}</p>}
    </>
  );
}
