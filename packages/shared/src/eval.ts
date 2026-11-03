// Eval deposit and progress rules. Spec: CLAUDE.md sections 7.2 and 7.3.
import type { Eval } from "./types.js";

export const MAX_RETRIES = 3;
export const YOCTO_PER_NEAR = 10n ** 24n;
/** 0.02 NEAR per OutLayer run, in yoctoNEAR. */
export const COMPUTE_PER_RUN = 20_000_000_000_000_000_000_000n;

/** Every shard, aggregation and the retries. */
export function computeBudget(shardCount: number): bigint {
  return BigInt(shardCount + 1 + MAX_RETRIES) * COMPUTE_PER_RUN;
}

/** Deposit for `request_eval`. `storage` comes from the `eval_storage_deposit` view. */
export function evalDeposit(
  price: bigint,
  shardCount: number,
  storage: bigint,
): bigint {
  return price + computeBudget(shardCount) + storage;
}

/**
 * Whether `continue_dispatch` has something to send. Callers must send it without waiting for
 * final execution and must never retry it automatically.
 */
export function canContinueDispatch(
  evaluation: Pick<Eval, "status" | "retry_shards" | "partials">,
): boolean {
  if (evaluation.status === "Dispatching") return true;
  if (evaluation.status !== "Grading") return false;
  return (
    evaluation.retry_shards.length > 0 ||
    evaluation.partials.every((p) => p !== null)
  );
}

export function formatNear(yocto: bigint | string, digits = 4): string {
  const value = BigInt(yocto);
  const whole = value / YOCTO_PER_NEAR;
  const frac = (value % YOCTO_PER_NEAR)
    .toString()
    .padStart(24, "0")
    .slice(0, digits)
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Parses a decimal NEAR amount into yoctoNEAR. Throws on malformed input. */
export function parseNear(text: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,24}))?$/.exec(text.trim());
  if (!match) throw new Error("expected a NEAR amount like 1.5");
  return (
    BigInt(match[1]!) * YOCTO_PER_NEAR +
    BigInt((match[2] ?? "").padEnd(24, "0"))
  );
}
