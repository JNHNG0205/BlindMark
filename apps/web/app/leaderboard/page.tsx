import Link from "next/link";
import { formatNear } from "@blindmark/shared";
import {
  Distribution,
  LatestCertificates,
  Sidebar,
} from "../../components/explorer";
import { ArrowRight, Tree } from "../../components/icons";
import { Interval } from "../../components/interval";
import { loadExplore, type ExploreRow as Row } from "../../lib/explore";
import { pct, timeAgo } from "../../lib/format";

export const dynamic = "force-dynamic";

type Params = { b?: string; tier?: string; q?: string; sort?: string };

const SORTS = {
  issued: (a: Row, b: Row) => b.certificate.eval_id - a.certificate.eval_id,
  score: (a: Row, b: Row) => b.certificate.score_bps - a.certificate.score_bps,
  n: (a: Row, b: Row) => b.certificate.n_items - a.certificate.n_items,
} as const;
type SortKey = keyof typeof SORTS;

function href(current: Params, patch: Partial<Params>): string {
  const next = { ...current, ...patch };
  const query = new URLSearchParams(
    Object.entries(next).filter(
      (entry): entry is [string, string] => !!entry[1] && entry[1] !== "all",
    ),
  ).toString();
  return query ? `/leaderboard?${query}` : "/leaderboard";
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const sort: SortKey =
    params.sort && params.sort in SORTS ? (params.sort as SortKey) : "issued";

  // A failed read throws to app/error.tsx, which shows a plain message and a retry.
  const data = await loadExplore();
  const now = data.readAt;
  const query = params.q?.trim().toLowerCase() ?? "";
  const rows = data.rows
    .filter((r) => !params.b || String(r.benchmark.id) === params.b)
    .filter((r) => !params.tier || r.certificate.trust_tier === params.tier)
    .filter(
      (r) =>
        !query ||
        r.certificate.model_id.toLowerCase().includes(query) ||
        r.benchmark.title.toLowerCase().includes(query),
    )
    .sort(SORTS[sort]);

  return (
    <div className="app">
      <Sidebar active="leaderboard" rows={data.rows} tier={params.tier} />

      <main className="explorer">
        <section className="overview">
          <Distribution rows={data.rows} />
          <div className="panel ov-card">
            <h2 className="ov-title">
              <Tree /> Benchmarks
            </h2>
            <ul className="ov-list">
              {data.benchmarks.slice(0, 3).map((b) => (
                <li key={b.id}>
                  <Link href={`/benchmarks/${b.id}`}>{b.title}</Link>
                  <span className="mono">
                    {b.item_count} items · {formatNear(b.price)} NEAR
                  </span>
                </li>
              ))}
              {data.benchmarks.length === 0 && (
                <li className="muted">None registered yet.</li>
              )}
            </ul>
            <Link href="/benchmarks/new" className="ov-more">
              Register one <ArrowRight />
            </Link>
          </div>
          <LatestCertificates certificates={data.certificates} now={now} />
        </section>

        <div className="toolbar">
          <nav className="tabs" aria-label="Benchmark">
            <Link
              href={href(params, { b: "all" })}
              aria-current={!params.b ? "page" : undefined}
            >
              All benchmarks
            </Link>
            {data.benchmarks.map((b) => (
              <Link
                key={b.id}
                href={href(params, { b: String(b.id) })}
                aria-current={params.b === String(b.id) ? "page" : undefined}
              >
                {b.title}
              </Link>
            ))}
          </nav>
          <form className="search" action="/leaderboard">
            {params.b && <input type="hidden" name="b" value={params.b} />}
            {params.tier && (
              <input type="hidden" name="tier" value={params.tier} />
            )}
            <input
              type="search"
              name="q"
              defaultValue={params.q}
              placeholder="Search models or benchmarks"
              aria-label="Search models or benchmarks"
            />
          </form>
        </div>

        <div className="panel grid-panel">
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Model / benchmark</th>
                  <th>95% interval</th>
                  <SortHead
                    label="Score"
                    k="score"
                    params={params}
                    sort={sort}
                  />
                  <th className="num">Change</th>
                  <SortHead label="n" k="n" params={params} sort={sort} />
                  <th>Tier</th>
                  <th className="num">Attempts</th>
                  <SortHead
                    label="Issued"
                    k="issued"
                    params={params}
                    sort={sort}
                  />
                  <th className="actions-head">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.benchmark.id}:${r.certificate.model_id}`}>
                    <td>
                      <div className="who">
                        <span className="rank">#{r.rank}</span>
                        <div>
                          <span className="model mono">
                            {r.certificate.model_id}
                          </span>
                          <span className="bench">
                            {" / "}
                            {r.benchmark.title} v
                            {r.certificate.benchmark_version}
                          </span>
                          {r.tiedWith.length > 0 && (
                            <span className="tied">
                              tied with #{r.tiedWith.join(", #")}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <Interval
                        score={r.certificate.score_bps}
                        low={r.certificate.ci_low_bps}
                        high={r.certificate.ci_high_bps}
                        bare
                      />
                    </td>
                    <td className="num strong">
                      {pct(r.certificate.score_bps)}
                    </td>
                    <td className="num">
                      <Change bps={r.change} />
                    </td>
                    <td className="num">{r.certificate.n_items}</td>
                    <td>
                      <span className={`tier tier-${r.certificate.trust_tier}`}>
                        {r.certificate.trust_tier}
                      </span>
                    </td>
                    <td className="num">{r.attempts}</td>
                    <td className="num muted">
                      {timeAgo(r.certificate.issued_at_ns, now)}
                    </td>
                    <td>
                      <div className="actions">
                        <Link
                          href={`/certificates/${r.certificate.eval_id}`}
                          className="button ghost sm"
                        >
                          Certificate
                        </Link>
                        <Link
                          href={`/benchmarks/${r.benchmark.id}`}
                          className="button sm"
                        >
                          Evaluate
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <div className="grid-empty">
              <p>No certificates match these filters.</p>
              <Link href="/leaderboard" className="button ghost sm">
                Clear filters
              </Link>
            </div>
          )}
          <p className="grid-foot">
            One row per model and benchmark: its latest certificate, never its
            best of N. Intervals that overlap are statistically tied.
          </p>
        </div>
      </main>
    </div>
  );
}

function SortHead({
  label,
  k,
  params,
  sort,
}: {
  label: string;
  k: SortKey;
  params: Params;
  sort: SortKey;
}) {
  const active = sort === k;
  return (
    <th className="num" aria-sort={active ? "descending" : undefined}>
      <Link
        href={href(params, { sort: k === "issued" ? undefined : k })}
        className={active ? "sort active" : "sort"}
      >
        {label}
        <svg width="8" height="10" viewBox="0 0 8 10" aria-hidden="true">
          <path
            d="M1 6.5l3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      </Link>
    </th>
  );
}

function Change({ bps }: { bps: number | null }) {
  if (bps === null) return <span className="muted">first</span>;
  if (bps === 0) return <span className="muted">0.0 pts</span>;
  const up = bps > 0;
  return (
    <span className={up ? "up" : "down"}>
      {up ? "+" : "-"}
      {(Math.abs(bps) / 100).toFixed(1)} pts
    </span>
  );
}
