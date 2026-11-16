#!/usr/bin/env bash
# Run the hub CLI straight from the repo, no install needed: ./hub.sh agent <project>, ./hub.sh up --demo
# No arguments = the same as `hub`: the menu in a terminal (agent, admin, check, mail filters), the help otherwise.
set -euo pipefail
HUB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/app/apps/installer/bin/hub.mjs"
exec node "$HUB" "$@"
