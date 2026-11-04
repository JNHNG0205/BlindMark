# X post draft

Draft only. The human edits and posts it (hard rule 1). Fill in the bracketed parts once a real certificate exists. Each post is under 280 characters.

## Thread

**1/**
Public AI benchmarks leak into training data, so the scores stop meaning anything. Keeping a test set private means someone has to be trusted with it.

BlindMark is private AI benchmarking on NEAR, built for the NEAR hackathon. [demo video link]

**2/**
NEAR AI Cloud runs models in a TEE, but whoever calls the model still sees the prompts.

So in BlindMark the caller is a neutral grader running in a second TEE (Intel TDX on OutLayer). The benchmark owner never sees the answers; the model team never sees the questions.

**3/**
The owner encrypts the test set in the browser. The key is locked in OutLayer so that only the approved grader build, called through the BlindMark contract, can read it.

A changed grader gets a different hash and cannot read the key.

**4/**
Each result is a certificate on NEAR: the score with a 95% interval, the dataset root, and the grader build hash. The fee is escrowed and paid only when a certificate is issued.

[model] scored [score] on math-v1: [certificate link]

**5/**
Anyone can check a certificate with one command, no keys needed:

pnpm blindmark verify [eval_id]

It recomputes the Merkle root, matches OutLayer's attestations to the certified build, and verifies the Intel TDX quotes.

**6/**
Limitations are in the README: tier A only for Confidential TEE models, trust in Intel TDX and NVIDIA, and the owner holds the key, so a certificate proves the grading, not the owner's honesty.

Code: [repo link]
@NEARProtocol @near_ai [OutLayer handle]
