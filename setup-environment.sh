#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

echo "setup-environment.sh now performs a non-privileged project setup."
echo "Install Node.js 22.12.0+ separately if it is not already available."
exec "$SCRIPT_DIR/install-dependencies.sh"
