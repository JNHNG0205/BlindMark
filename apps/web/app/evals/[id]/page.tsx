import { notFound } from "next/navigation";
import { AppShell } from "../../../components/app-shell";
import { EvalStatusView } from "./eval-status";

export default async function EvalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return (
    <AppShell crumbs={[{ label: `Evaluation ${id}` }]}>
      <header className="page-head">
        <div>
          <h1>Evaluation {id}</h1>
          <p className="page-sub">
            Live from the contract. Shards are graded inside the TEE; only the
            aggregate score is ever published.
          </p>
        </div>
      </header>
      <EvalStatusView evalId={Number(id)} />
    </AppShell>
  );
}
