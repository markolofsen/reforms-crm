#!/bin/bash
# `pnpm live`: the agent live-edit loop (see app/@rules/live-edit.md).
#
# Serves apps/admin from a separate git worktree on branch `app-live` (Next dev server with hot reload, port 5273) next to the
# owner's checkout. An agent started in that worktree edits the admin app; scripts/live-commit.sh turns each edit
# into one commit there. The API, packages/* and node_modules come from this (main) checkout.
#
#   pnpm live           set up the worktree if needed, start the API (if not running) and the live Next dev server
#   pnpm live status    where the worktree is and which commits are not merged yet
set -eu

app=$(cd "$(dirname "$0")/.." && pwd -P)
top=$(git -C "$app" rev-parse --show-toplevel)
app_rel=${app#"$top"/}
wt=${HUB_LIVE_DIR:-$HOME/.reforms-crm/app-live}
wt_app=$wt/$app_rel
port=${HUB_LIVE_PORT:-5273}
api_port=${HUB_PORT:-4317}

if [ "$(git -C "$top" symbolic-ref --short -q HEAD || true)" = "app-live" ]; then
  echo "live: run this from the main checkout, not from the app-live worktree." >&2
  exit 1
fi

if [ "${1:-}" = "status" ]; then
  echo "worktree: $wt_app"
  git -C "$top" log --oneline main..app-live 2>/dev/null | sed 's/^/  unmerged: /' || true
  exit 0
fi

# The live branch is cut from main's HEAD, so uncommitted admin work in main would be missing from it.
if [ -n "$(git -C "$top" status --porcelain -- "$app_rel/apps/admin")" ]; then
  echo "live: refusing to start: $app_rel/apps/admin has uncommitted changes in the main checkout." >&2
  echo "      Commit or discard them first (git status -- $app_rel/apps/admin)." >&2
  exit 1
fi

if [ ! -d "$wt" ]; then
  mkdir -p "$(dirname "$wt")"
  if git -C "$top" show-ref --verify --quiet refs/heads/app-live; then
    git -C "$top" worktree add --no-checkout "$wt" app-live
  else
    git -C "$top" worktree add --no-checkout -b app-live "$wt" HEAD
  fi
  # Only what the loop needs: a repo of 18k files is not checked out for one app. `packages/ui` is here so Tailwind finds the
  # tokens and class strings the admin's stylesheet imports (read-only: the hook refuses edits outside apps/admin).
  git -C "$wt" sparse-checkout set --cone "$app_rel/apps/admin" "$app_rel/packages/ui" "$app_rel/scripts" "$app_rel/.claude"
  git -C "$wt" checkout -q app-live
else
  # A worktree made before `packages/ui` existed lacks it: set is idempotent.
  git -C "$wt" sparse-checkout set --cone "$app_rel/apps/admin" "$app_rel/packages/ui" "$app_rel/scripts" "$app_rel/.claude"
  # No live commits yet: follow main. Live commits present: keep them (merge or drop them first).
  if [ -z "$(git -C "$top" log --oneline HEAD..app-live)" ] && [ -z "$(git -C "$wt" status --porcelain)" ]; then
    git -C "$wt" merge -q --ff-only "$(git -C "$top" rev-parse HEAD)" 2>/dev/null || true
  fi
fi
[ -f "$wt_app/.claude/settings.json" ] || { echo "live: $wt_app/.claude/settings.json is missing: commit the hook to main first." >&2; exit 1; }

# One install, shared: the worktree borrows main's node_modules (untracked; workspace packages stay main's).
ln -sfn "$app/node_modules" "$wt_app/node_modules"
ln -sfn "$app/apps/admin/node_modules" "$wt_app/apps/admin/node_modules"

started_api=""
if ! curl -fsS "http://127.0.0.1:$api_port/api/health" >/dev/null 2>&1; then
  (cd "$app" && pnpm --filter @hub/server start) &
  started_api=$!
  for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$api_port/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
fi
trap '[ -n "$started_api" ] && kill "$started_api" 2>/dev/null || true' EXIT INT TERM

cat <<MSG

  live admin   http://127.0.0.1:$port/
  worktree     $wt_app   (branch app-live)
  start agent  cd "$wt_app" && claude
  undo an edit git -C "$wt" revert <sha>      (list: git -C "$wt" log --oneline main..app-live)
  keep edits   git merge app-live             (from the main checkout)

MSG
# Turbopack follows the symlinked node_modules only when its root is a directory holding both checkouts (rules: live-edit).
case "$app" in "$HOME"/*) next_root=$HOME ;; *) next_root=/ ;; esac
cd "$wt_app/apps/admin"
HUB_NEXT_ROOT="$next_root" HUB_PORT="$api_port" exec ./node_modules/.bin/next dev -H 127.0.0.1 -p "$port"
