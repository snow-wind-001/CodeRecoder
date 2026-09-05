#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/.." && pwd)"
launcher_script="${script_directory}/start-coderecoder-desktop.sh"
icon_file="${script_directory}/assets/coderecoder.png"
pin_to_dock=false

if [[ "${1:-}" == '--pin' ]]; then
  pin_to_dock=true
elif [[ $# -gt 0 ]]; then
  printf 'Usage: %s [--pin]\n' "$0" >&2
  exit 2
fi

[[ "${repository_root}" != *$'\n'* ]] || { printf 'Repository paths containing newlines are unsupported.\n' >&2; exit 1; }
[[ -x "${launcher_script}" ]] || { printf 'Desktop launcher is not executable: %s\n' "${launcher_script}" >&2; exit 1; }
[[ -f "${icon_file}" ]] || { printf 'Desktop icon is missing: %s\n' "${icon_file}" >&2; exit 1; }

account_directory="$(getent passwd "$(id -u)" | cut -d: -f6)"
data_directory="${XDG_DATA_HOME:-${account_directory}/.local/share}"
applications_directory="${data_directory}/applications"
desktop_file="${applications_directory}/coderecoder.desktop"
mkdir -p -- "${applications_directory}"

temporary_file="$(mktemp "${TMPDIR:-/tmp}/coderecoder.desktop.XXXXXX")"
cleanup() {
  rm -f -- "${temporary_file}"
}
trap cleanup EXIT

cat >"${temporary_file}" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=CodeRecoder
GenericName=Code Backup Console
Comment=Inspect verified code backups and control safe restores
Exec="${launcher_script}"
Icon=${icon_file}
Path=${repository_root}
Terminal=false
Categories=Development;
Keywords=backup;snapshot;restore;MCP;code;
StartupNotify=true
StartupWMClass=CodeRecoder
EOF

install -m 0644 "${temporary_file}" "${desktop_file}"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${applications_directory}"
fi

if [[ "${pin_to_dock}" == true ]]; then
  command -v gsettings >/dev/null 2>&1 || { printf 'gsettings is required to pin CodeRecoder to GNOME Dock.\n' >&2; exit 1; }
  favorites="$(gsettings get org.gnome.shell favorite-apps)"
  if [[ "${favorites}" != *"'coderecoder.desktop'"* ]]; then
    if [[ "${favorites}" == '@as []' || "${favorites}" == '[]' ]]; then
      favorites="['coderecoder.desktop']"
    elif [[ "${favorites}" == \[*\] ]]; then
      favorites="${favorites%]}, 'coderecoder.desktop']"
    else
      printf 'Unable to parse GNOME favorite-apps: %s\n' "${favorites}" >&2
      exit 1
    fi
    gsettings set org.gnome.shell favorite-apps "${favorites}"
  fi
fi

printf 'Installed CodeRecoder launcher: %s\n' "${desktop_file}"
if [[ "${pin_to_dock}" == true ]]; then
  printf 'Pinned coderecoder.desktop to GNOME Dock.\n'
fi
