import Link from "next/link";
import type { ReactNode } from "react";
import { Sidebar } from "./explorer";

/** Sidebar layout for detail pages, with a breadcrumb trail above the content. */
export function AppShell({
  active = "none",
  crumbs,
  children,
}: {
  active?: "home" | "leaderboard" | "register" | "none";
  /** Trail after "Benchmarks"; the last entry is the current page. */
  crumbs: { label: string; href?: string }[];
  children: ReactNode;
}) {
  return (
    <div className="app">
      <Sidebar active={active} />
      <main className="explorer detail">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/">Benchmarks</Link>
          {crumbs.map((c, i) => (
            <span key={i} className="crumb">
              <span aria-hidden="true">/</span>
              {c.href && i < crumbs.length - 1 ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span
                  aria-current={i === crumbs.length - 1 ? "page" : undefined}
                >
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>
        {children}
      </main>
    </div>
  );
}
