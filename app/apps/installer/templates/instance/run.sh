#!/usr/bin/env bash
# Run the hub for THIS instance: ./run.sh agent <project>, ./run.sh up, ./run.sh doctor. Sets HUB_HOME to this folder, runs the pinned core/.
set -euo pipefail
HOME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export HUB_HOME="$HOME_DIR"
exec "$HOME_DIR/core/hub.sh" "$@"
