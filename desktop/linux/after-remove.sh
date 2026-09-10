#!/bin/sh
set -eu
for command in coderecoder-mcp coderecoder-install-serena; do
  if [ "$(readlink "/usr/bin/$command" 2>/dev/null || true)" = "/opt/CodeRecoder/bin/$command" ]; then
    rm -f -- "/usr/bin/$command"
  fi
done
