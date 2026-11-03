// Pieces shared by the explorer views: sidebar and overview cards.
import Link from "next/link";
import type { Certificate } from "@blindmark/shared";
import type { ExploreRow } from "../lib/explore";
import { pct, timeAgo } from "../lib/format";
import { Chip, Fingerprint, Ledger, Lock } from "./icons";

export function Sidebar({
  active,
  rows,
  tier,
}: {
  active: "home" | "leaderboard" | "register" | "none";
  /** Latest rows for the tier counts; detail pages skip the counts. */
  rows?: ExploreRow[];
  /** Current tier filter on the leaderboard, if any. */
  tier?: string;
}) {
  const count = (t: string) =>
    !rows
      ? null
      : t === "all"
        ? rows.length
        : rows.filter((r) => r.certificate.trust_tier === t).length;
  return (
    <aside className="app-sidebar" aria-label="Sections">
      <nav>
        <Link href="/" aria-current={active === "home" ? "page" : undefined}>
          <Chip /> Benchmarks
        </Link>
        <Link
          href="/leaderboard"
          aria-current={active === "leaderboard" && !tier ? "page" : undefined}
        >
          <Ledger /> Leaderboard
        </Link>
        <Link
          href="/benchmarks/new"
          aria-current={active === "register" ? "page" : undefined}
        >
          <Lock /> Register benchmark
        </Link>
        <Link href="/#verify">
          <Fingerprint /> Verify
        </Link>
      </nav>
      <p className="sidebar-head">Trust tier</p>
      <nav>
        {(["all", "A", "B", "C"] as const).map((t) => (
          <Link
            key={t}
            href={t === "all" ? "/leaderboard" : `/leaderboard?tier=${t}`}
            aria-current={
              active === "leaderboard" && (tier ?? "all") === t
                ? "page"
                : undefined
            }
          >
            <span className={`tier tier-${t}`}>{t === "all" ? "All" : t}</span>
            {t === "all" ? "Every tier" : `Tier ${t}`}
            {rows && <span className="count">{count(t)}</span>}
          </Link>
        ))}
      </nav>
      <p className="sidebar-note">
        Tier A: open model and grader both in a TEE. Prompts hidden from
        everyone.
      </p>
    </aside>
  );
}

/** Histogram of the latest score per model, in ten 10-point buckets. */
export function Distribution({ rows }: { rows: ExploreRow[] }) {
  const buckets = Array.from({ length: 10 }, () => 0);
  for (const r of rows) {
    buckets[Math.min(9, Math.floor(r.certificate.score_bps / 1000))]! += 1;
  }
  const max = Math.max(1, ...buckets);
  return (
    <div className="panel ov-card dist">
      <h2 className="ov-title">
        <Ledger /> Score distribution
      </h2>
      <p className="dist-total">
        <span>{rows.length}</span> {rows.length === 1 ? "model" : "models"}{" "}
        certified · {rows.reduce((n, r) => n + r.certificate.n_items, 0)} items
        graded
      </p>
      <div
        className="bars"
        role="img"
        aria-label="Latest scores by 10-point bucket"
      >
        {buckets.map((count, i) => (
          <span
            key={i}
            className={count ? "bar" : "bar empty"}
            style={{ height: `${count ? 12 + (count / max) * 88 : 4}%` }}
            title={`${i * 10} to ${i * 10 + 10}%: ${count}`}
          />
        ))}
      </div>
      <div className="bars-axis mono">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export function LatestCertificates({
  certificates,
  now,
}: {
  certificates: Certificate[];
  now: number;
}) {
  const latest = [...certificates]
    .sort((a, b) => b.eval_id - a.eval_id)
    .slice(0, 3);
  return (
    <div className="panel ov-card">
      <h2 className="ov-title">
        <Fingerprint /> Latest certificates
      </h2>
      <ul className="ov-list">
        {latest.map((c) => (
          <li key={c.eval_id}>
            <Link href={`/certificates/${c.eval_id}`}>{c.model_id}</Link>
            <span className="mono">
              {pct(c.score_bps)} · {timeAgo(c.issued_at_ns, now)} ago
            </span>
          </li>
        ))}
        {latest.length === 0 && <li className="muted">No certificates yet.</li>}
      </ul>
      <Link href="/leaderboard" className="ov-more">
        Full leaderboard
      </Link>
    </div>
  );
}
