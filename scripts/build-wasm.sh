#!/usr/bin/env bash
# Build the simulation cores to WebAssembly and generate the JS/TS bindings used by web/.
set -euo pipefail
cd "$(dirname "$0")/.."

cargo build -p sim-wasm --target wasm32-unknown-unknown --profile wasm-release
mkdir -p web/src/wasm/pkg
wasm-bindgen --target web --typescript --out-dir web/src/wasm/pkg \
  target/wasm32-unknown-unknown/wasm-release/sim_wasm.wasm

cargo build -p svm-wasm --target wasm32-unknown-unknown --profile wasm-release
mkdir -p web/src/svm/wasm/pkg
wasm-bindgen --target web --typescript --out-dir web/src/svm/wasm/pkg \
  target/wasm32-unknown-unknown/wasm-release/svm_wasm.wasm

/bin/ls -la web/src/wasm/pkg
/bin/ls -la web/src/svm/wasm/pkg
