#!/bin/sh
set -euo pipefail

echo "EMWaver does not ship a public CLI installer."
echo "The CLI is internal/dev-only tooling (build + DFU flash)."
echo "Build from source instead:"
echo "  cd cli && cargo build --release"
exit 1
