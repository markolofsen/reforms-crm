#!/usr/bin/env bash
# Run the hub for THIS instance: ./run.sh setup, ./run.sh agent <project>, ./run.sh up, ./run.sh doctor. Sets HUB_HOME to this folder, runs the pinned core/.
# A fresh clone needs nothing else (P89): a missing core/ checkout is fetched at the pinned commit, missing dependencies are installed by core/install.sh.
set -euo pipefail
HOME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export HUB_HOME="$HOME_DIR"
if [ ! -e "$HOME_DIR/core/hub.sh" ]; then
  echo "==> core/ is not checked out yet (cloned without --recurse-submodules): fetching it at the commit core.version pins"
  git -C "$HOME_DIR" submodule update --init core
fi
if [ ! -e "$HOME_DIR/core/app/apps/installer/node_modules/tsx" ]; then
  if [ "${1:-}" != "setup" ]; then
    echo "error: the core's dependencies are not installed on this Mac yet. Run ./run.sh setup first (it installs them)." >&2
    exit 1
  fi
  echo "==> the core's dependencies are not installed on this Mac yet: running core/install.sh (Node, pnpm, packages), then setup"
  shift
  exec "$HOME_DIR/core/install.sh" "$@"
fi
exec "$HOME_DIR/core/hub.sh" "$@"
