#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$PROJECT_ROOT/app"
VENV_DIR="$APP_DIR/.venv"
DEFAULT_UPLOAD_TOKEN="changeme"
DEFAULT_MEDIA_DIR="$APP_DIR/media"
DEFAULT_HOST="0.0.0.0"
DEFAULT_PORT="8000"

log() {
  printf "\033[1;32m[pi-media]\033[0m %s\n" "$1"
}

prompt() {
  local message="$1" default="$2" var
  read -r -p "$message [$default]: " var
  if [[ -z "$var" ]]; then
    echo "$default"
  else
    echo "$var"
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: $1 is required but not found in PATH." >&2
    exit 1
  fi
}

main() {
  require_cmd python3
  require_cmd pip

  local upload_token media_dir host port
  upload_token=$(prompt "Upload token" "$DEFAULT_UPLOAD_TOKEN")
  media_dir=$(prompt "Media directory" "$DEFAULT_MEDIA_DIR")
  host=$(prompt "Host" "$DEFAULT_HOST")
  port=$(prompt "Port" "$DEFAULT_PORT")

  log "Using app directory: $APP_DIR"
  log "Creating virtual environment at $VENV_DIR (if missing)"
  if ! python3 -m venv "$VENV_DIR"; then
    cat >&2 <<'ERR'
Unable to create a virtual environment. Install the venv tooling and try again, e.g.:
  # Debian/Ubuntu
  sudo apt-get update && sudo apt-get install -y python3-venv python3-pip

  # Fedora
  sudo dnf install -y python3-venv python3-pip

  # macOS (Homebrew)
  brew install python
ERR
    exit 1
  fi

  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"

  log "Installing dependencies"
  pip install --upgrade pip >/dev/null
  pip install -r "$APP_DIR/requirements.txt"

  log "Ensuring media directory exists at $media_dir"
  mkdir -p "$media_dir"

  export UPLOAD_TOKEN="$upload_token"
  export MEDIA_DIR="$media_dir"

  export PYTHONPATH="$PROJECT_ROOT:${PYTHONPATH:-}"

  log "Ready to launch"
  echo "Env: UPLOAD_TOKEN=$UPLOAD_TOKEN"
  echo "Env: MEDIA_DIR=$MEDIA_DIR"
  echo "Env: PYTHONPATH=$PYTHONPATH"
  echo "Command: python -m uvicorn app.main:app --host $host --port $port"

  if [[ ${AUTO_START:-yes} == "yes" ]]; then
    read -r -p "Start the server now? [Y/n] " start_now
    if [[ -z "$start_now" || "$start_now" =~ ^[Yy]$ ]]; then
      cd "$APP_DIR"
      python -m uvicorn app.main:app --host "$host" --port "$port"
      exit 0
    fi
  fi

  log "To start later, run:"
  echo "cd $APP_DIR && source $VENV_DIR/bin/activate"
  echo "UPLOAD_TOKEN=$UPLOAD_TOKEN MEDIA_DIR=$MEDIA_DIR python -m uvicorn app.main:app --host $host --port $port"
}

main "$@"
