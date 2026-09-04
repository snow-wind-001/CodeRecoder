#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 22.12.0 or newer is required" >&2
  exit 1
fi

if ! node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)"; then
  echo "Error: found $(node --version); Node.js 22.12.0 or newer is required" >&2
  exit 1
fi

if [[ ! -f dist/index.js ]]; then
  echo "CodeRecoder is not built; running npm run build" >&2
  npm run build >&2
fi

exec node dist/index.js
