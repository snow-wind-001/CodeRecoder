#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Checking CodeRecoder runtime..."
node --version

echo "Checking TypeScript and the MCP initialize lifecycle..."
npm run lint
npm run test:mcp

echo "Local MCP server verification passed."
echo "Confirm client registration separately with one of:"
echo "  codex mcp list"
echo "  claude mcp list"
echo "Then inspect get_backup_status after activate_project."
