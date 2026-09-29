#!/usr/bin/env bash
set -euo pipefail

# Pin the upstream source revision; Python dependencies are resolved by uv.
serena_revision='701e7c843f46c6a649203a488cece1bf19f1df90'
serena_source="https://github.com/oraios/serena/archive/${serena_revision}.tar.gz"
explicit_source=false
with_dotnet=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      [[ $# -ge 2 ]] || { printf '%s requires a directory\n' "$1" >&2; exit 2; }
      serena_source="$(realpath -- "$2")"
      [[ -f "${serena_source}/pyproject.toml" ]] || { printf 'Not a Serena source directory: %s\n' "${serena_source}" >&2; exit 1; }
      explicit_source=true
      shift 2
      ;;
    --with-dotnet) with_dotnet=true; shift ;;
    *) printf 'Usage: %s [--source /path/to/serena] [--with-dotnet]\n' "$0" >&2; exit 2 ;;
  esac
done

[[ "$(id -u)" != 0 ]] || { printf 'Install Serena as your desktop user, without sudo.\n' >&2; exit 1; }
account_directory="$(getent passwd "$(id -u)" | cut -d: -f6)"
bin_directory="${account_directory}/.local/bin"
serena_executable="${bin_directory}/serena"
mkdir -p -- "${bin_directory}"

download_installer() {
  command -v curl >/dev/null 2>&1 || { printf 'curl is required. Install curl and retry.\n' >&2; exit 1; }
  curl --fail --location --retry 2 --connect-timeout 20 --max-time 180 --proto '=https' --tlsv1.2 "$1" --output "$2"
}

if [[ "${with_dotnet}" == true ]]; then
  dotnet_executable="$(command -v dotnet || true)"
  if [[ -z "${dotnet_executable}" ]] || ! "${dotnet_executable}" --list-runtimes | grep -qE '^Microsoft.NETCore.App 10\.'; then
    dotnet_directory="${account_directory}/.dotnet"
    if [[ ! -x "${dotnet_directory}/dotnet" ]] || ! "${dotnet_directory}/dotnet" --list-runtimes | grep -qE '^Microsoft.NETCore.App 10\.'; then
      temporary_file="$(mktemp "${TMPDIR:-/tmp}/coderecoder-dotnet.XXXXXX")"
      trap 'rm -f -- "${temporary_file}"' EXIT
      download_installer 'https://dot.net/v1/dotnet-install.sh' "${temporary_file}"
      bash "${temporary_file}" --channel 10.0 --quality GA --install-dir "${dotnet_directory}" --no-path
      rm -f -- "${temporary_file}"
      trap - EXIT
    fi
    if [[ -e "${bin_directory}/dotnet" || -L "${bin_directory}/dotnet" ]]; then
      [[ "$(readlink -f -- "${bin_directory}/dotnet")" == "${dotnet_directory}/dotnet" ]] || {
        printf 'An existing %s blocks the .NET launcher. Add %s to PATH and retry.\n' "${bin_directory}/dotnet" "${dotnet_directory}" >&2
        exit 1
      }
    else
      ln -s -- "${dotnet_directory}/dotnet" "${bin_directory}/dotnet"
    fi
    dotnet_executable="${bin_directory}/dotnet"
  fi
  "${dotnet_executable}" --list-runtimes
fi

if [[ "${explicit_source}" == false && -x "${serena_executable}" ]] && "${serena_executable}" --version; then
  printf 'Serena is ready: %s\n' "${serena_executable}"
  exit 0
fi

uv_executable="$(command -v uv || true)"
if [[ -z "${uv_executable}" && -x "${bin_directory}/uv" ]]; then
  uv_executable="${bin_directory}/uv"
fi
if [[ -z "${uv_executable}" && -x /snap/bin/uv ]]; then
  uv_executable=/snap/bin/uv
fi
if [[ -z "${uv_executable}" ]]; then
  temporary_file="$(mktemp "${TMPDIR:-/tmp}/coderecoder-uv.XXXXXX")"
  trap 'rm -f -- "${temporary_file}"' EXIT
  download_installer 'https://astral.sh/uv/0.11.1/install.sh' "${temporary_file}"
  UV_INSTALL_DIR="${bin_directory}" UV_NO_MODIFY_PATH=1 sh "${temporary_file}"
  uv_executable="${bin_directory}/uv"
fi

printf 'Installing Serena from %s\n' "${serena_source}"
UV_TOOL_BIN_DIR="${bin_directory}" "${uv_executable}" tool install \
  --python 3.12 --managed-python --reinstall "${serena_source}"
"${serena_executable}" --version
printf 'Serena is ready for CodeRecoder and MCP clients: %s\n' "${serena_executable}"
