import Link from "next/link";
import { notFound } from "next/navigation";
import { formatNear } from "@blindmark/shared";
import { AppShell } from "../../../components/app-shell";
import { ArrowRight } from "../../../components/icons";
import { Interval } from "../../../components/interval";
import { formatDate, pct } from "../../../lib/format";
import { leaderboard } from "../../../lib/leaderboard";
import {
  getBackends,
  getBenchmark,
  getModels,
  listCertificates,
} from "../../../lib/rpc";
import { RequestEval } from "./request-eval";

export const dynamic = "force-dynamic";

export default async function BenchmarkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const benchmark = await getBenchmark(Number(id));
  if (!benchmark) notFound();
  const [certificates, models, backends] = await Promise.all([
    listCertificates(benchmark.id),
    getModels(),
    getBackends(),
  ]);
  const hours = Number(BigInt(benchmark.cooldown_ns) / 3_600_000_000_000n);
  const rows = leaderboard(certificates);

  return (
    <AppShell crumbs={[{ label: benchmark.title }]}>
      <header className="page-head">
        <div>
          <h1>
            {benchmark.title}
            <span className="tag">v{benchmark.version}</span>
          </h1>
          <p className="page-sub">{benchmark.description}</p>
        </div>
        <div className="price-block">
          <span className="price">{formatNear(benchmark.price)} NEAR</span>
          <span className="muted">
            per evaluation, paid only on a certificate
          </span>
        </div>
      </header>

      <dl className="stat-strip">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`status ${benchmark.status}`}>
              {benchmark.status}
            </span>
          </dd>
        </div>
        <div>
          <dt>Items</dt>
          <dd>{benchmark.item_count}</dd>
        </div>
        <div>
          <dt>Encrypted shards</dt>
          <dd>{benchmark.shard_hashes.length}</dd>
        </div>
        <div>
          <dt>Grading</dt>
          <dd>{benchmark.grading_type}</dd>
        </div>
        <div>
          <dt>Limits</dt>
          <dd>
            {benchmark.max_evals_per_model} per model · {hours} h cooldown
          </dd>
        </div>
        <div>
          <dt>Models certified</dt>
          <dd>{rows.length}</dd>
        </div>
      </dl>

      <div className="detail-body">
        <div className="detail-main">
          <section>
            <div className="section-head">
              <h2>Certificates</h2>
              {certificates.length > 0 && (
                <Link
                  href={`/leaderboard?b=${benchmark.id}`}
                  className="ov-more"
                >
                  Leaderboard for this benchmark <ArrowRight />
                </Link>
              )}
            </div>
            <div className="panel grid-panel">
              {certificates.length === 0 ? (
                <p className="grid-note">
                  None yet. The first certified evaluation appears here.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>Eval</th>
                        <th>Model</th>
                        <th>95% interval</th>
                        <th className="num">Score</th>
                        <th>Tier</th>
                        <th className="num">Issued</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...certificates]
                        .sort((a, b) => b.eval_id - a.eval_id)
                        .map((c) => (
                          <tr key={c.eval_id}>
                            <td>
                              <Link
                                href={`/certificates/${c.eval_id}`}
                                className="rank"
                              >
                                {c.eval_id}
                              </Link>
                            </td>
                            <td className="mono">{c.model_id}</td>
                            <td>
                              <Interval
                                score={c.score_bps}
                                low={c.ci_low_bps}
                                high={c.ci_high_bps}
                                bare
                              />
                            </td>
                            <td className="num strong">{pct(c.score_bps)}</td>
                            <td>
                              <span className={`tier tier-${c.trust_tier}`}>
                                {c.trust_tier}
                              </span>
                            </td>
                            <td className="num muted">
                              {formatDate(c.issued_at_ns)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="panel commitments">
            <h3>Commitments</h3>
            <dl>
              <dt>Owner</dt>
              <dd>
                <code>{benchmark.owner}</code>
              </dd>
              <dt>Dataset root</dt>
              <dd>
                <code>{benchmark.dataset_root}</code>
              </dd>
              <dt>Protocol, sha256(JCS)</dt>
              <dd>
                <code>{benchmark.protocol_hash}</code>
                <a href={benchmark.protocol_uri} rel="noreferrer">
                  protocol.json
                </a>
              </dd>
              <dt>Sample items</dt>
              <dd>
                {benchmark.sample_items_uri ? (
                  <a href={benchmark.sample_items_uri} rel="noreferrer">
                    Public samples
                  </a>
                ) : (
                  <span className="muted">None published</span>
                )}
              </dd>
              <dt>Registered</dt>
              <dd>
                {formatDate(benchmark.created_at_ns)}, block{" "}
                {benchmark.created_block}
              </dd>
            </dl>
          </section>
        </div>

        <aside className="detail-aside">
          {benchmark.status === "Active" ? (
            <RequestEval
              benchmark={benchmark}
              models={models}
              backends={backends}
            />
          ) : (
            <section className="card">
              <h2 className="card-title">Retired</h2>
              <p className="muted">
                This version takes no new evaluations. Existing evaluations
                still complete.
              </p>
            </section>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
