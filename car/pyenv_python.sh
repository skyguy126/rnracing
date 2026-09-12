#!/usr/bin/env bash
# Folder-local pyenv interpreter. systemd and sudo do not load pyenv shims.
#
#   source pyenv_python.sh          # defines resolve_python (uses SCRIPT_DIR)
#   ./pyenv_python.sh script.py …   # exec that interpreter
#
: "${SERVICE_USER:=rnracing}"

# Nearest .python-version from dir upward (same walk pyenv local uses).
nearest_python_version() {
  local dir
  dir="$(cd "$1" && pwd)"
  while [[ "${dir}" != "/" ]]; do
    if [[ -f "${dir}/.python-version" ]]; then
      echo "${dir}/.python-version"
      return 0
    fi
    dir="$(dirname "${dir}")"
  done
  return 1
}

# First non-comment version name in a pyenv version file.
read_pyenv_version() {
  local line
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%%#*}"
    line="${line//[$' \t\r']/}"
    [[ -n "${line}" ]] || continue
    echo "${line}"
    return 0
  done <"$1"
  return 1
}

python_for_version() {
  local root="$1" version="$2" candidate
  if [[ "${version}" == "system" ]]; then
    echo /usr/bin/python3
    return 0
  fi
  for candidate in \
    "${root}/versions/${version}/bin/python3" \
    "${root}/versions/${version}/bin/python"
  do
    if [[ -x "${candidate}" ]]; then
      echo "${candidate}"
      return 0
    fi
  done
  return 1
}

# Print the real interpreter for SCRIPT_DIR's .python-version.
# Prefers the service user's pyenv so the unit and sudo scripts match.
resolve_python() {
  local version_file="" version="" home="" root="" candidate="" resolved=""
  local -a roots=()

  version_file="$(nearest_python_version "${SCRIPT_DIR}" || true)"
  if [[ -z "${version_file}" ]]; then
    echo /usr/bin/python3
    return 0
  fi
  version="$(read_pyenv_version "${version_file}")" || {
    echo "[-] Empty pyenv version file: ${version_file}" >&2
    exit 1
  }
  PYTHON_VERSION_FILE="${version_file}"
  PYTHON_VERSION_NAME="${version}"
  if [[ "${version}" == "system" ]]; then
    echo /usr/bin/python3
    return 0
  fi

  if id "${SERVICE_USER}" >/dev/null 2>&1; then
    home="$(getent passwd "${SERVICE_USER}" | cut -d: -f6)"
    [[ -n "${home}" && -d "${home}/.pyenv" ]] && roots+=("${home}/.pyenv")
  fi
  if [[ ${#roots[@]} -eq 0 && -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    home="$(getent passwd "${SUDO_USER}" | cut -d: -f6)"
    [[ -n "${home}" && -d "${home}/.pyenv" ]] && roots+=("${home}/.pyenv")
  fi
  if [[ ${#roots[@]} -eq 0 && -n "${PYENV_ROOT:-}" && -d "${PYENV_ROOT}" ]]; then
    roots+=("${PYENV_ROOT}")
  fi

  for root in "${roots[@]+"${roots[@]}"}"; do
    if candidate="$(python_for_version "${root}" "${version}")"; then
      echo "${candidate}"
      return 0
    fi
    if [[ -x "${root}/bin/pyenv" ]]; then
      resolved="$(
        cd "${SCRIPT_DIR}" && PYENV_ROOT="${root}" "${root}/bin/pyenv" which python3 2>/dev/null || true
      )"
      if [[ -n "${resolved}" && -x "${resolved}" && "${resolved}" != */shims/* ]]; then
        echo "${resolved}"
        return 0
      fi
    fi
  done

  echo "[-] No interpreter for pyenv ${version} (${version_file})." >&2
  if [[ ${#roots[@]} -eq 0 ]]; then
    echo "    pyenv not found for ${SERVICE_USER} (~/.pyenv)." >&2
  else
    echo "    Install that version in ${roots[0]}, then re-run." >&2
  fi
  exit 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  exec "$(resolve_python)" "$@"
fi
