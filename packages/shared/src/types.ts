// TS mirror of the data formats (CLAUDE.md section 5), grader messages (section 6,
// crates/blindmark-types/src/wire.rs) and contract records (section 7.1,
// contracts/blindmark/src/types.rs). `U128` and `U64` fields are decimal strings in JSON.

import type { ProofStep } from "./merkle.js";

export type GradingType =
  "mcq" | "exact" | "numeric" | "regex" | "llm_judge" | "unit_test";

export const GRADING_TYPES: readonly GradingType[] = [
  "mcq",
  "exact",
  "numeric",
  "regex",
  "llm_judge",
  "unit_test",
];

/** Plaintext benchmark item. Private: never log it or send it anywhere unencrypted. */
export interface Item {
  id: string;
  prompt: string;
  choices: string[] | null;
  answer: string;
  grading_type: GradingType | null;
  rubric: string | null;
  metadata?: Record<string, unknown>;
}

export interface Protocol {
  version: number;
  system_prompt: string;
  prompt_template: string;
  few_shot: unknown[];
  model_params: { temperature: number; max_tokens: number };
  grading: {
    default_type: GradingType;
    normalize: string[];
    numeric_tolerance: number;
    answer_extraction: string;
  };
  metric: string;
  rules: { attempts_per_item: number; tools: boolean };
}

/** Shard plaintext before encryption. Private. */
export interface ShardPlaintext {
  benchmark_id: number;
  version: number;
  shard_index: number;
  items: Item[];
}

export interface GradeRequest {
  mode: "grade";
  eval_id: number;
  benchmark_id: number;
  version: number;
  shard_index: number;
  shard_uri: string;
  shard_hash: string;
  merkle_proof: ProofStep[];
  dataset_root: string;
  protocol_uri: string;
  protocol_hash: string;
  model_id: string;
  nonce: string;
}

export type GraderError =
  | "shard_fetch"
  | "hash_mismatch"
  | "decrypt"
  | "protocol"
  | "model_call"
  | "seal"
  | "upload";

export interface GradeResult {
  eval_id: number;
  shard_index: number;
  shard_hash: string;
  sealed_partial: string;
  evidence_hash: string;
  backend: string;
  ok: boolean;
  error: GraderError | null;
}

export interface AggregateRequest {
  mode: "aggregate";
  eval_id: number;
  expected_shards: number;
  sealed_partials: { shard_index: number; sealed: string }[];
  n_items_expected: number;
  nonce: string;
}

export interface AggregateResult {
  eval_id: number;
  n_items: number;
  n_correct: number;
  score_bps: number;
  ci_low_bps: number;
  ci_high_bps: number;
  mean_latency_ms: number;
  ok: boolean;
  error: GraderError | null;
}

export type BackendKind = "OutLayer" | "ShadeDstack";

export interface Backend {
  id: string;
  kind: BackendKind;
  /** WASM sha256 or image digest. Also the OutLayer `version_key`. */
  measurement: string;
  outlayer_project: string | null;
  active: boolean;
}

export interface ModelInfo {
  id: string;
  tier: string;
  active: boolean;
}

export interface SecretRef {
  owner: string;
  profile: string;
}

export interface RegisterBenchmarkArgs {
  version: number;
  title: string;
  description: string;
  grading_type: string;
  dataset_root: string;
  protocol_hash: string;
  protocol_uri: string;
  shard_uris: string[];
  shard_hashes: string[];
  item_count: number;
  sample_items_uri: string | null;
  price: string;
  secret_ref: SecretRef;
  /** Defaults to 3. */
  max_evals_per_model: number | null;
  /** Defaults to 24 hours. */
  cooldown_ns: string | null;
}

export interface Benchmark {
  id: number;
  version: number;
  owner: string;
  title: string;
  description: string;
  grading_type: string;
  dataset_root: string;
  protocol_hash: string;
  protocol_uri: string;
  shard_uris: string[];
  shard_hashes: string[];
  item_count: number;
  sample_items_uri: string | null;
  price: string;
  secret_ref: SecretRef;
  max_evals_per_model: number;
  cooldown_ns: string;
  status: "Active" | "Retired";
  created_at_ns: string;
  created_block: number;
}

export type EvalStatus =
  | "Dispatching"
  | "Grading"
  | "Aggregating"
  | "Certified"
  | "Failed"
  | "Refunded";

export interface Eval {
  id: number;
  benchmark_id: number;
  requester: string;
  model_id: string;
  backend_id: string;
  fee: string;
  compute_budget: string;
  compute_spent: string;
  status: EvalStatus;
  next_shard_to_dispatch: number;
  retries_left: number;
  retry_shards: number[];
  partials: (string | null)[];
  evidence_hashes: (string | null)[];
  nonce: string;
  created_at_ns: string;
  created_block: number;
  deadline_ns: string;
}

export interface Certificate {
  eval_id: number;
  benchmark_id: number;
  benchmark_version: number;
  dataset_root: string;
  protocol_hash: string;
  model_id: string;
  trust_tier: string;
  backend_id: string;
  grader_measurement: string;
  n_items: number;
  n_correct: number;
  score_bps: number;
  ci_low_bps: number;
  ci_high_bps: number;
  mean_latency_ms: number;
  evidence_hashes: string[];
  issued_at_ns: string;
  issued_block: number;
}

export interface Usage {
  count: number;
  last_requested_ns: string;
}
