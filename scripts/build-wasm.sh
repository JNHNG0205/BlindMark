#!/usr/bin/env bash
# Builds the OutLayer WASM binaries and prints their sha256 for local development.
# Published measurements must come from OutLayer's build_github_wasm.sh (CLAUDE.md section 8).
set -euo pipefail

cd "$(dirname "$0")/.."

cargo build -p outlayer-grader -p outlayer-keyrelease --target wasm32-wasip2 --release
shasum -a 256 \
  target/wasm32-wasip2/release/outlayer-grader.wasm \
  target/wasm32-wasip2/release/outlayer-keyrelease.wasm
