#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/dist/index.js"

if [[ ! -f "$ENTRYPOINT" ]]; then
  echo "CodeRecoder is not built. Run: npm run build" >&2
  exit 1
fi

echo "This helper no longer rewrites client configuration files automatically."
echo "Choose the command for your client:"
echo
echo "Codex:"
echo "  codex mcp add coderecoder -- node $ENTRYPOINT"
echo
echo "Claude Code:"
echo "  claude mcp add --scope user coderecoder -- node $ENTRYPOINT"
echo
echo "For JSON-based clients, use:"
echo "  {\"mcpServers\":{\"coderecoder\":{\"command\":\"node\",\"args\":[\"$ENTRYPOINT\"]}}}"
echo
echo "See MCP_CONFIG_GUIDE.md for approval and restore-safety guidance."
