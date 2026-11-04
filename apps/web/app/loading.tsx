import { AppShell } from "../components/app-shell";

// Server routes read the contract (and, for certificates, OutLayer) before rendering.
export default function Loading() {
  return (
    <AppShell crumbs={[{ label: "Loading" }]}>
      <section className="card" aria-busy="true">
        <p className="muted">Reading the BlindMark contract on NEAR...</p>
      </section>
    </AppShell>
  );
}
