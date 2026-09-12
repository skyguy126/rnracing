#!/usr/bin/env bash
# Repo pyenv interpreter. .python-version lives in the repo root, one
# folder above car/. systemd and sudo do not load pyenv shims.
#
#   source pyenv_python.sh          # defines resolve_python (uses SCRIPT_DIR)
#   ./pyenv_python.sh script.py …   # exec that interpreter
#
: "${SERVICE_USER:=rnracing}"

# .python-version is in the repo root (parent of car/). A copy in car/ still works.
nearest_python_version() {
  local car parent
  car="$(cd "$1" && pwd)"
  parent="$(cd "${car}/.." && pwd)"
  if [[ -f "${parent}/.python-version" ]]; then
    echo "${parent}/.python-version"
    return 0
  fi
  if [[ -f "${car}/.python-version" ]]; then
    echo "${car}/.python-version"
    return 0
  fi
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

# Print the real interpreter for the repo's .python-version (parent of car/).
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
        cd "$(dirname "${version_file}")" && PYENV_ROOT="${root}" "${root}/bin/pyenv" which python3 2>/dev/null || true
      )"
      if [[ -n "${resolved}" && -x "${resolved}" && "${resolved}" != */shims/* ]]; then
        echo "${resolved}"
        return 0
      fi
    fi
  done

  echo "[-] No interpreter for pyenv ${version} (${version_file})." >&2
  if [[ ${#roots[@]} -eq 0 ]]; then
    echo "    pyenv not found for ${SERVICE_USER} (~/.pyenv). Expected ${version_file}." >&2
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
