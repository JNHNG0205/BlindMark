import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stop `next dev` from writing AGENTS.md; agent instructions live in the root CLAUDE.md and AGENTS.md.
  agentRules: false,
  // CommonJS quote verifier used by the certificate page on the server; load it from node_modules.
  serverExternalPackages: ["@phala/dcap-qvl"],
};

export default nextConfig;
