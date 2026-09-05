#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/.." && pwd)"

fail_launch() {
  local message="$1"
  printf 'CodeRecoder: %s\n' "${message}" >&2
  if command -v notify-send >/dev/null 2>&1; then
    notify-send --app-name=CodeRecoder --icon="${script_directory}/assets/coderecoder.png" \
      'CodeRecoder 无法启动' "${message}"
  fi
  exit 1
}

node_is_supported() {
  local candidate="$1"
  local major
  local minor
  IFS=. read -r major minor _ < <("${candidate}" -p 'process.versions.node' 2>/dev/null) || return 1
  [[ "${major}" =~ ^[0-9]+$ && "${minor}" =~ ^[0-9]+$ ]] || return 1
  (( major > 22 || (major == 22 && minor >= 12) ))
}

node_executable=""
current_node="$(command -v node 2>/dev/null || true)"
if [[ -n "${current_node}" ]] && node_is_supported "${current_node}"; then
  node_executable="${current_node}"
else
  account_directory="$(getent passwd "$(id -u)" | cut -d: -f6)"
  nvm_directory="${NVM_DIR:-${account_directory}/.nvm}"
  for candidate in "${nvm_directory}"/versions/node/v*/bin/node; do
    if [[ -x "${candidate}" ]] && node_is_supported "${candidate}"; then
      node_executable="${candidate}"
    fi
  done
fi

[[ -n "${node_executable}" ]] || fail_launch '需要 Node.js 22.12.0 或更高版本。'
node_bin_directory="$(dirname -- "${node_executable}")"
npm_executable="${node_bin_directory}/npm"
[[ -x "${npm_executable}" ]] || fail_launch '未在所选 Node.js 安装中找到 npm。'
[[ -d "${repository_root}/node_modules/electron" ]] || fail_launch '依赖尚未安装，请先在仓库中运行 npm install。'

export PATH="${node_bin_directory}:${PATH:-/usr/local/bin:/usr/bin:/bin}"
cd -- "${repository_root}"
exec "${npm_executable}" run desktop:start
