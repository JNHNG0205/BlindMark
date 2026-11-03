import Link from "next/link";
import type { Benchmark } from "@blindmark/shared";
import { formatNear } from "@blindmark/shared";
import {
  Distribution,
  LatestCertificates,
  Sidebar,
} from "../components/explorer";
import {
  ArrowRight,
  Chip,
  Fingerprint,
  Ledger,
  Lock,
  Signature,
  Tree,
} from "../components/icons";
import { loadExplore, type ExploreData } from "../lib/explore";
import { pct, timeAgo } from "../lib/format";

export const dynamic = "force-dynamic";

type Params = { status?: string; q?: string };

function homeHref(status: string | undefined, query: string): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (query) params.set("q", query);
  const text = params.toString();
  return text ? `/?${text}` : "/";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  let data: ExploreData;
  try {
    data = await loadExplore();
  } catch (error) {
    return (
      <main>
        <h1>BlindMark</h1>
        <p className="error">
          Could not read the contract: {(error as Error).message}
        </p>
      </main>
    );
  }
  const now = data.readAt;
  const query = params.q?.trim() ?? "";
  const needle = query.toLowerCase();
  const status =
    params.status === "Active" || params.status === "Retired"
      ? params.status
      : undefined;
  const benchmarks = data.benchmarks
    .filter((b) => !status || b.status === status)
    .filter(
      (b) =>
        !needle ||
        b.title.toLowerCase().includes(needle) ||
        b.description.toLowerCase().includes(needle),
    )
    .sort((a, b) => b.id - a.id);
  const leader = (b: Benchmark) =>
    data.rows.find((r) => r.benchmark.id === b.id && r.rank === 1);
  const models = (b: Benchmark) =>
    data.rows.filter((r) => r.benchmark.id === b.id).length;

  return (
    <div className="app">
      <Sidebar active="home" rows={data.rows} />

      <main className="explorer">
        <Intro />

        <section className="overview">
          <Distribution rows={data.rows} />
          <div className="panel ov-card">
            <h2 className="ov-title">
              <Tree /> Leaders
            </h2>
            <ul className="ov-list">
              {data.benchmarks.slice(0, 3).map((b) => {
                const top = leader(b);
                return (
                  <li key={b.id}>
                    <Link href={`/benchmarks/${b.id}`}>{b.title}</Link>
                    <span className="mono">
                      {top
                        ? `${top.certificate.model_id} ${pct(top.certificate.score_bps)}`
                        : "no certificate yet"}
                    </span>
                  </li>
                );
              })}
              {data.benchmarks.length === 0 && (
                <li className="muted">No benchmarks registered yet.</li>
              )}
            </ul>
            <Link href="/benchmarks/new" className="ov-more">
              Register a benchmark <ArrowRight />
            </Link>
          </div>
          <LatestCertificates certificates={data.certificates} now={now} />
        </section>

        <div className="toolbar">
          <nav className="tabs" aria-label="Status">
            {(
              [
                ["All benchmarks", undefined],
                ["Active", "Active"],
                ["Retired", "Retired"],
              ] as const
            ).map(([label, value]) => (
              <Link
                key={label}
                href={homeHref(value, query)}
                aria-current={status === value ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <form className="search" action="/">
            {status && <input type="hidden" name="status" value={status} />}
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search benchmarks"
              aria-label="Search benchmarks"
            />
          </form>
        </div>

        <div className="panel grid-panel">
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Benchmark</th>
                  <th className="num">Items</th>
                  <th className="num">Shards</th>
                  <th className="num">Price</th>
                  <th className="num">Models</th>
                  <th>Leader</th>
                  <th>Status</th>
                  <th className="num">Registered</th>
                  <th className="actions-head">Actions</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b) => {
                  const top = leader(b);
                  return (
                    <tr key={b.id}>
                      <td>
                        <div className="who">
                          <span className="rank">v{b.version}</span>
                          <div>
                            <Link
                              href={`/benchmarks/${b.id}`}
                              className="model plain"
                            >
                              {b.title}
                            </Link>
                            <span className="bench">
                              {" / "}
                              {b.grading_type}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="num">{b.item_count}</td>
                      <td className="num">{b.shard_hashes.length}</td>
                      <td className="num strong">{formatNear(b.price)} NEAR</td>
                      <td className="num">{models(b)}</td>
                      <td>
                        {top ? (
                          <Link
                            href={`/certificates/${top.certificate.eval_id}`}
                            className="leader"
                          >
                            <span className="mono">
                              {top.certificate.model_id}
                            </span>
                            <span className="leader-score">
                              {pct(top.certificate.score_bps)}
                            </span>
                          </Link>
                        ) : (
                          <span className="muted">none yet</span>
                        )}
                      </td>
                      <td>
                        <span className={`status ${b.status}`}>{b.status}</span>
                      </td>
                      <td className="num muted">
                        {timeAgo(b.created_at_ns, now)}
                      </td>
                      <td>
                        <div className="actions">
                          <Link
                            href={`/leaderboard?b=${b.id}`}
                            className="button ghost sm"
                          >
                            Results
                          </Link>
                          {b.status === "Active" && (
                            <Link
                              href={`/benchmarks/${b.id}`}
                              className="button sm"
                            >
                              Evaluate
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {benchmarks.length === 0 && (
            <div className="grid-empty">
              <p>
                {data.benchmarks.length === 0
                  ? "No benchmarks registered yet."
                  : "No benchmarks match these filters."}
              </p>
              <Link
                href={data.benchmarks.length === 0 ? "/benchmarks/new" : "/"}
                className="button ghost sm"
              >
                {data.benchmarks.length === 0
                  ? "Register the first one"
                  : "Clear filters"}
              </Link>
            </div>
          )}
          <p className="grid-foot">
            Test sets stay encrypted. You see the protocol, item count and
            price; the questions are only ever read inside the grader TEE.
          </p>
        </div>

        <Insight />
        <Verify />
      </main>
    </div>
  );
}

const CHAIN = [
  {
    icon: <Chip />,
    who: "NEAR AI Cloud",
    proves: "This model produced these answers; nobody saw the prompts.",
  },
  {
    icon: <Lock />,
    who: "Grader on OutLayer TEE",
    proves:
      "These hidden questions, graded by this exact code, gave this score.",
  },
  {
    icon: <Ledger />,
    who: "BlindMark contract",
    proves: "The certificate is public and permanent; the fee was paid.",
  },
];

function Intro() {
  return (
    <section className="intro">
      <div className="intro-copy">
        <h1>
          <span className="line">Private test sets.</span>
          <span className="line">Scores nobody can fake.</span>
        </h1>
        <p>
          Benchmark owners keep their questions secret and get paid. Model teams
          get scores graded inside a TEE. Every result is a public certificate
          on NEAR.
        </p>
        <div className="intro-actions">
          <Link href="/benchmarks/new" className="button">
            Register a benchmark <ArrowRight />
          </Link>
          <Link href="#how" className="button ghost">
            How it works
          </Link>
        </div>
      </div>
      <ol className="intro-chain" aria-label="Trust chain">
        {CHAIN.map((c) => (
          <li key={c.who}>
            <span className="intro-icon">{c.icon}</span>
            <div>
              <strong>{c.who}</strong>
              <span>{c.proves}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Insight() {
  return (
    <section className="split" id="how">
      <div className="split-copy">
        <h2>Whoever calls the model sees the questions</h2>
        <p className="lede">
          NEAR AI&apos;s TEE hides requests from NEAR and the infrastructure,
          not from the caller. So the caller is a neutral grader in a second
          TEE. The owner never sees the model team&apos;s run, and the model
          team never sees the questions.
        </p>
        <ul className="points">
          <li>
            <Lock />
            <div>
              <strong>Questions stay sealed</strong>
              <span>
                Shards are encrypted in the owner&apos;s browser. Only the
                approved grader build, called through the contract, can read the
                key.
              </span>
            </div>
          </li>
          <li>
            <Fingerprint />
            <div>
              <strong>The grader is pinned</strong>
              <span>
                Every run names the grader&apos;s WASM hash. A changed build
                cannot decrypt, and cannot certify.
              </span>
            </div>
          </li>
          <li>
            <Ledger />
            <div>
              <strong>Only the total leaves</strong>
              <span>
                Per-shard results are sealed. The contract publishes the
                aggregate score and its confidence interval.
              </span>
            </div>
          </li>
        </ul>
      </div>
      <Flow />
    </section>
  );
}

/** Data path diagram: who holds what, and what each party gets to see. */
function Flow() {
  return (
    <figure className="flow" aria-label="Data path">
      <div className="flow-row">
        <div className="node">
          <span className="node-role">Benchmark owner</span>
          <span className="node-holds">holds key K</span>
        </div>
        <div className="node">
          <span className="node-role">Model team</span>
          <span className="node-holds">pays the fee</span>
        </div>
      </div>
      <div className="wire" data-step="1" aria-hidden="true">
        <span>encrypted shards</span>
        <span>request_eval</span>
      </div>
      <div className="node sealed" data-step="1">
        <span className="node-role">
          <Lock /> Grader TEE
        </span>
        <span className="node-holds">decrypts, asks, grades</span>
      </div>
      <div className="wire single" data-step="2" aria-hidden="true">
        <span>E2EE prompts</span>
      </div>
      <div className="node sealed" data-step="2">
        <span className="node-role">
          <Chip /> Model TEE
        </span>
        <span className="node-holds">answers, signs each response</span>
      </div>
      <div className="wire single" data-step="3" aria-hidden="true">
        <span>aggregate only</span>
      </div>
      <div className="node out" data-step="3">
        <span className="node-role">
          <Ledger /> Certificate on NEAR
        </span>
        <span className="node-holds mono">
          score, 95% CI, n, evidence hashes
        </span>
      </div>
    </figure>
  );
}

function Verify() {
  return (
    <section className="split reverse" id="verify">
      <div className="terminal">
        <div className="terminal-bar">
          <span>verify a certificate</span>
          <span className="muted">example output</span>
        </div>
        <pre>
          <span className="prompt">$</span> pnpm blindmark verify 0{"\n"}
          {"\n"}
          <span className="ok">PASS</span> certificate exists, eval Certified
          {"\n"}
          <span className="ok">PASS</span> commitments match the benchmark{"\n"}
          <span className="ok">PASS</span> merkle root recomputed{"\n"}
          <span className="ok">PASS</span> grader build matches backend{"\n"}
          <span className="ok">PASS</span> Wilson interval recomputed
        </pre>
      </div>
      <div className="split-copy">
        <h2>Don&apos;t trust the page. Check it.</h2>
        <p className="lede">
          One command reads the certificate from the contract and rechecks it
          from public data. Any failed check exits non-zero.
        </p>
        <ul className="points">
          <li>
            <Tree />
            <div>
              <strong>Commitments</strong>
              <span>
                The dataset root and protocol hash match what the owner
                registered before the eval.
              </span>
            </div>
          </li>
          <li>
            <Fingerprint />
            <div>
              <strong>Grader build</strong>
              <span>
                The certificate names the exact WASM measurement that graded it.
              </span>
            </div>
          </li>
          <li>
            <Signature />
            <div>
              <strong>Model evidence</strong>
              <span>
                Each response signature is checked against the model&apos;s TEE
                attestation. Missing signatures are reported, never counted.
              </span>
            </div>
          </li>
        </ul>
      </div>
    </section>
  );
}
