#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/.." && pwd)"
prepare_only=false
launch_log=""

if [[ $# -eq 1 && "${1}" == '--prepare' ]]; then
  prepare_only=true
elif [[ $# -gt 0 ]]; then
  printf 'Usage: %s [--prepare]\n' "$0" >&2
  exit 2
fi

fail_launch() {
  local message="$1"
  if [[ -n "${launch_log}" ]]; then
    message="${message} 日志：${launch_log}"
  fi
  printf 'CodeRecoder: %s\n' "${message}" >&2
  if [[ "${prepare_only}" == false ]] && command -v notify-send >/dev/null 2>&1; then
    notify-send --app-name=CodeRecoder --icon="${script_directory}/assets/coderecoder.png" \
      'CodeRecoder 无法启动' "${message}" || true
  fi
  exit 1
}

account_directory="$(getent passwd "$(id -u)" | cut -d: -f6)"
if [[ "${prepare_only}" == false ]]; then
  state_directory="${XDG_STATE_HOME:-${account_directory}/.local/state}/coderecoder"
  mkdir -p -- "${state_directory}" || fail_launch '无法创建启动日志目录。'
  launch_log="${state_directory}/desktop-launch.log"
  exec >>"${launch_log}" 2>&1
  printf '\n[%s] Starting CodeRecoder Desktop\n' "$(date --iso-8601=seconds)"
fi

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

if [[ -z "${ELECTRON_GET_USE_PROXY+x}" && -n "${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-}}}}" ]]; then
  export ELECTRON_GET_USE_PROXY=1
fi

if ! "${node_executable}" node_modules/electron/install.js; then
  fail_launch 'Electron 运行程序准备失败，请检查网络或 HTTP(S)_PROXY 后重新运行安装命令。'
fi
if ! "${node_executable}" -e "require('node:fs').accessSync(require('electron'), require('node:fs').constants.X_OK)"; then
  fail_launch 'Electron 运行程序缺失或没有执行权限。'
fi
if ! "${npm_executable}" run desktop:build; then
  fail_launch '桌面构建失败，请检查构建错误后重新运行安装命令。'
fi

if [[ "${prepare_only}" == true ]]; then
  exit 0
fi
exec "${node_executable}" node_modules/electron/cli.js dist-desktop/main/index.js
