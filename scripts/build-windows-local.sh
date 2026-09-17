#!/usr/bin/env bash
# Reuse the isolated cross-toolchain prepared for this workspace.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/.tools/cargo-tools/bin:$PWD/.tools/bin:$PWD/.tools/sysroot/usr/lib/llvm-18/bin:$PATH"
export LD_LIBRARY_PATH="$PWD/.tools/sysroot/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export XWIN_CACHE_DIR="$PWD/.tools/xwin"
npm run tauri -- build --runner cargo-xwin --target x86_64-pc-windows-msvc "$@"
