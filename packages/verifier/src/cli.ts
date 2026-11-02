#!/usr/bin/env node
// `blindmark verify <eval_id>`. Spec: CLAUDE.md section 10.

const [command, evalId] = process.argv.slice(2);

if (command !== "verify" || !evalId) {
  console.error(
    "usage: blindmark verify <eval_id> [--network testnet] [--contract <account>] [--json]",
  );
  process.exit(2);
}

// Fails until implemented: a stub must never report a certificate as verified.
console.error(`FAIL  verifier not implemented; eval ${evalId} was not checked`);
process.exit(1);
