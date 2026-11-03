import { AppShell } from "../../../components/app-shell";
import { NewBenchmarkWizard } from "./wizard";

export default function NewBenchmarkPage() {
  return (
    <AppShell active="register" crumbs={[{ label: "Register benchmark" }]}>
      <header className="page-head">
        <div>
          <h1>Register a benchmark</h1>
          <p className="page-sub">
            Your items are encrypted in this browser and never leave it in
            plaintext. Only the ciphertext, its hashes and the public protocol
            are published.
          </p>
        </div>
      </header>
      <div className="wizard">
        <NewBenchmarkWizard />
      </div>
    </AppShell>
  );
}
