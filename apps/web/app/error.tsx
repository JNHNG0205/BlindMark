"use client";

// Shown when a route fails to load, usually because the NEAR RPC or OutLayer API did not answer.
// Retrying only re-reads data; it never sends a transaction.
import Link from "next/link";
import { AppShell } from "../components/app-shell";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppShell crumbs={[{ label: "Could not load" }]}>
      <section className="card">
        <h1 style={{ marginTop: 0 }}>This page could not load</h1>
        <p>
          Reading the BlindMark contract or OutLayer failed, often because an
          RPC node was slow or unavailable. Nothing was sent from your wallet.
        </p>
        {error.digest && <p className="muted mono">Reference {error.digest}</p>}
        <div className="row">
          <button onClick={reset}>Try again</button>
          <Link href="/">Back to benchmarks</Link>
        </div>
      </section>
    </AppShell>
  );
}
