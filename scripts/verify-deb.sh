#!/usr/bin/env bash
set -euo pipefail
repository_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
package_path="${1:-}"
[[ -f "${package_path}" ]] || { printf 'Usage: %s /path/to/CodeRecoder.deb\n' "$0" >&2; exit 2; }
temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/coderecoder_deb.XXXXXX")"
trap 'rm -rf -- "${temporary_directory}"' EXIT
dpkg-deb --info "${package_path}"
[[ "$(dpkg-deb --field "${package_path}" Package)" == coderecoder ]]
[[ "$(dpkg-deb --field "${package_path}" Architecture)" == amd64 ]]
expected_version="$(node -p 'require(process.argv[1]).version' "${repository_directory}/package.json")"
[[ "$(dpkg-deb --field "${package_path}" Version)" == "${expected_version}" ]]
dpkg-deb --extract "${package_path}" "${temporary_directory}"
dpkg-deb --control "${package_path}" "${temporary_directory}/control"
desktop-file-validate "${temporary_directory}/usr/share/applications/coderecoder.desktop"
bash -n "${temporary_directory}/control/postinst" "${temporary_directory}/control/postrm"
test -x "${temporary_directory}/opt/CodeRecoder/bin/coderecoder-install-serena"
node "${repository_directory}/test/packaged-mcp.mjs" "${temporary_directory}/opt/CodeRecoder/bin/coderecoder-mcp"
printf 'PASS: Debian metadata, desktop entry, hooks and bundled MCP runtime\n'
