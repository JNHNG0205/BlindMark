import Link from "next/link";
import { notFound } from "next/navigation";
import {
  runChecks,
  type ChainData,
  type CheckResult,
  type OffChainData,
  type Status,
} from "@blindmark/verifier/checks";
import {
  fetchOutLayerEvidence,
  OUTLAYER_ENDPOINTS,
} from "@blindmark/verifier/fetch";
import { AppShell } from "../../../components/app-shell";
import { CopyButton } from "../../../components/copy";
import { Chip, Ledger, Lock, Tree } from "../../../components/icons";
import { CONTRACT_ID, EXPLORER_URL, NETWORK_ID } from "../../../lib/config";
import { formatDate, pct } from "../../../lib/format";
import {
  getBackends,
  getBenchmark,
  getCertificate,
  getEval,
} from "../../../lib/rpc";

export const dynamic = "force-dynamic";

const TIERS: Record<string, string> = {
  A: "Open model in NEAR AI Confidential TEE, grader in TEE: prompts hidden from everyone",
  B: "Lab-run model in its own attested confidential VM",
  C: "Closed model via a normal API; leaks detectable, not prevented",
};

/** Hops of the data path, each backed by the verifier checks that cover it. */
const HOPS = [
  {
    icon: <Tree />,
    title: "Benchmark commitment",
    detail:
      "The owner committed to the encrypted shards and the protocol on-chain before this eval.",
    checks: [2, 3],
  },
  {
    icon: <Lock />,
    title: "Grader in OutLayer TEE",
    detail:
      "The contract pinned the run to one grader build; only that build can read the key.",
    checks: [4, 5],
  },
  {
    icon: <Chip />,
    title: "Model in NEAR AI TEE",
    detail:
      "The grader called the model over end-to-end encryption and kept signed evidence.",
    checks: [6],
  },
  {
    icon: <Ledger />,
    title: "Certificate on NEAR",
    detail:
      "The contract stored the score and paid out; the interval is recomputed from the counts.",
    checks: [1, 7],
  },
];

/**
 * OutLayer evidence per certified eval. A certified eval never changes, so a successful fetch
 * is kept for the life of the server process; a failed one is retried on the next view.
 */
const outlayerCache = new Map<
  number,
  Promise<NonNullable<OffChainData["outlayer"]>>
>();

function outlayerEvidence(data: ChainData) {
  const cached = outlayerCache.get(data.eval_id);
  if (cached) return cached;
  const at = OUTLAYER_ENDPOINTS[NETWORK_ID];
  if (!at)
    return Promise.resolve({
      error: `no OutLayer endpoints for ${NETWORK_ID}`,
    });
  const pending = fetchOutLayerEvidence(data, at).then((result) => {
    if ("error" in result) outlayerCache.delete(data.eval_id);
    return result;
  });
  outlayerCache.set(data.eval_id, pending);
  return pending;
}

function worst(results: CheckResult[]): Status {
  if (results.some((r) => r.status === "FAIL")) return "FAIL";
  if (results.some((r) => r.status === "WARN")) return "WARN";
  return "PASS";
}

const STATUS_WORD: Record<Status, string> = {
  PASS: "Verified",
  WARN: "Partly verified",
  FAIL: "Verification failed",
};

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const evalId = Number(id);
  const [certificate, evaluation, backends] = await Promise.all([
    getCertificate(evalId),
    getEval(evalId),
    getBackends(),
  ]);
  if (!certificate) notFound();
  const benchmark = await getBenchmark(certificate.benchmark_id);
  const data: ChainData = {
    eval_id: evalId,
    certificate,
    evaluation,
    benchmark,
    backends,
  };
  // Same checks and data as `pnpm blindmark verify`, so both report the same statuses.
  const offChain: OffChainData =
    evaluation?.status === "Certified"
      ? { outlayer: await outlayerEvidence(data) }
      : {};
  const results = runChecks(data, offChain);
  const overall = worst(results);
  const count = (s: Status) => results.filter((r) => r.status === s).length;
  const command = `pnpm blindmark verify ${evalId} --network ${NETWORK_ID} --contract ${CONTRACT_ID}`;
  const benchmarkTitle =
    benchmark?.title ?? `Benchmark ${certificate.benchmark_id}`;

  return (
    <AppShell
      crumbs={[
        {
          label: benchmarkTitle,
          href: `/benchmarks/${certificate.benchmark_id}`,
        },
        { label: `Certificate, eval ${evalId}` },
      ]}
    >
      <header className="cert-head">
        <div>
          <h1 className="mono-display">{certificate.model_id}</h1>
          <p className="cert-sub">
            on{" "}
            <Link href={`/benchmarks/${certificate.benchmark_id}`}>
              {benchmarkTitle}
            </Link>{" "}
            v{certificate.benchmark_version} · issued{" "}
            {formatDate(certificate.issued_at_ns)} · block{" "}
            <a
              href={`${EXPLORER_URL}/blocks/${certificate.issued_block}`}
              rel="noreferrer"
              target="_blank"
            >
              {certificate.issued_block}
            </a>
          </p>
        </div>
        <div className={`verdict ${overall}`}>
          <strong>{STATUS_WORD[overall]}</strong>
          <span className="mono">
            {count("PASS")} pass · {count("WARN")} warn · {count("FAIL")} fail
          </span>
        </div>
      </header>

      <section className="scorecard">
        <div className="score-main">
          <span className="score-label">Accuracy</span>
          <span className="score-value">{pct(certificate.score_bps)}</span>
          <span className="score-ci mono">
            95% CI {pct(certificate.ci_low_bps)} to{" "}
            {pct(certificate.ci_high_bps)}
          </span>
          <ScaleBar
            score={certificate.score_bps}
            low={certificate.ci_low_bps}
            high={certificate.ci_high_bps}
          />
        </div>
        <dl className="score-facts">
          <div>
            <dt>Correct</dt>
            <dd>
              {certificate.n_correct}
              <span> of {certificate.n_items}</span>
            </dd>
          </div>
          <div>
            <dt>Mean latency</dt>
            <dd>
              {certificate.mean_latency_ms.toLocaleString("en-US")}
              <span> ms</span>
            </dd>
          </div>
          <div className="tier-fact">
            <dt>Trust tier</dt>
            <dd>
              <span className={`tier tier-${certificate.trust_tier}`}>
                {certificate.trust_tier}
              </span>
              <p>{TIERS[certificate.trust_tier] ?? ""}</p>
            </dd>
          </div>
        </dl>
      </section>

      <div className="cert-body">
        <section aria-labelledby="path-title">
          <h2 id="path-title">Data path</h2>
          <p className="lede">
            Each hop is backed by the verifier checks that cover it. WARN means
            not verified, never verified by default.
          </p>
          <ol className="path">
            {HOPS.map((hop) => {
              const covered = results.filter((r) => hop.checks.includes(r.id));
              const status = covered.length === 0 ? "WARN" : worst(covered);
              return (
                <li key={hop.title} className={`hop ${status}`}>
                  <span className="hop-node">{hop.icon}</span>
                  <div className="hop-body">
                    <div className="hop-title">
                      <strong>{hop.title}</strong>
                      <span className={`badge ${status}`}>{status}</span>
                    </div>
                    <p>{hop.detail}</p>
                    {covered.map((r) => (
                      <details key={r.id} className="check">
                        <summary>
                          <span className={`badge ${r.status}`}>
                            {r.status}
                          </span>
                          <span>
                            {r.id}. {r.name}
                          </span>
                        </summary>
                        <ul>
                          {r.details.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                      </details>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="cert-aside">
          <div className="terminal">
            <div className="terminal-bar">
              <span>Verify it yourself</span>
              <CopyButton text={command} />
            </div>
            <pre>
              <span className="prompt">$</span>{" "}
              {`pnpm blindmark verify ${evalId} \\\n  --network ${NETWORK_ID} \\\n  --contract ${CONTRACT_ID}`}
            </pre>
            <p className="terminal-note">
              Read-only and needs no keys. Exits non-zero if any check fails.
            </p>
          </div>

          <section className="panel commitments">
            <h3>Commitments</h3>
            <dl>
              <dt>Grader build</dt>
              <dd>
                <span className="tag-inline">{certificate.backend_id}</span>
                <code>{certificate.grader_measurement}</code>
              </dd>
              <dt>Dataset root</dt>
              <dd>
                <code>{certificate.dataset_root}</code>
              </dd>
              <dt>Protocol hash</dt>
              <dd>
                <code>{certificate.protocol_hash}</code>
              </dd>
              <dt>Evidence bundles</dt>
              <dd>
                {certificate.evidence_hashes.length === 0 ? (
                  <span className="muted">None recorded</span>
                ) : (
                  certificate.evidence_hashes.map((h, i) => (
                    <code key={i}>{h}</code>
                  ))
                )}
              </dd>
            </dl>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

/** Wide error bar on a 0 to 100% scale with quarter ticks. */
function ScaleBar({
  score,
  low,
  high,
}: {
  score: number;
  low: number;
  high: number;
}) {
  return (
    <div className="scale" aria-hidden="true">
      <div className="scale-track">
        <span
          className="scale-range"
          style={{
            left: `${low / 100}%`,
            width: `${Math.max(0, high - low) / 100}%`,
          }}
        />
        <span className="scale-point" style={{ left: `${score / 100}%` }} />
      </div>
      <div className="scale-ticks mono">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
    </div>
  );
}
