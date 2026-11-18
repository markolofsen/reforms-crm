#!/bin/sh
# Hub Workflow bootstrap (manual-first): Node, pnpm, dependencies, then the minimal tokenless `hub setup` of an instance.
# `hub setup` writes into an instance, so it runs only when HUB_HOME is set (an instance's ./run.sh sets it);
# without HUB_HOME this script installs the core's dependencies and stops.
# Safe to rerun: every step first checks and does nothing when already done.
# No sudo, nothing deleted, no secrets read or printed. Extra arguments go to `hub setup`
# (for example --dry-run; --automation turns on the OPTIONAL background automation, off by default).
# `./install.sh --help` shows the plan. It ends with `ready: run hub agent`.

set -eu

say()  { printf '==> %s\n' "$*"; }
ok()   { printf '    ok: %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

case "${1:-}" in
  -h|--help)
    cat <<'HELP'
usage: ./install.sh [--dry-run] [--automation [--non-interactive]]

  1. checks Node against the engines of app/package.json (installs it with Homebrew when
     brew exists, otherwise prints the one-line fix and stops)
  2. enables pnpm through corepack (user-level shims; never sudo)
  3. pnpm install --frozen-lockfile in app/ (never edits pnpm-lock.yaml)
  4. with HUB_HOME set, runs `pnpm hub setup` for that instance (without it: stops after step 3 and says how to set up an instance): minimal and tokenless (folders, config, skills, project registry, doctor table);
     no Claude token, no Notion token, no launchd. `--automation` adds the OPTIONAL Notion token and Telegram token (mail goes through Apple Mail, no login)
  5. `hub setup` writes nothing outside the instance (`hub link` is the optional `hub` shortcut at ~/.local/bin/hub); it ends with `ready: run hub agent`, then you hand the session one instruction (skills/README.md)

This is the only shell script: everything else is the `hub` command (`hub --help`).

Rerun any time; finished steps are skipped. Arguments are passed on to `hub setup`.
HELP
    exit 0 ;;
esac

DRY=0
for a in "$@"; do [ "$a" = "--dry-run" ] && DRY=1; done

[ "$(id -u)" -ne 0 ] || die "do not run this as root: it needs no sudo, and files would end up owned by root"
[ "$(uname -s)" = "Darwin" ] || warn "this is not macOS: Mail.app (mail-mcp) needs a Mac, setup will report what it cannot do"

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP="$ROOT/app"
[ -f "$APP/package.json" ] || die "$APP/package.json not found: run this from a reforms-crm checkout"
say "reforms-crm in $ROOT"

# ---- 1. Node ---------------------------------------------------------------
# Minimum = the higher of app/ and the installer's engines (">=X.Y.Z").
engines() { sed -n 's/.*"node"[[:space:]]*:[[:space:]]*">=\{0,1\}\([0-9][0-9.]*\)".*/\1/p' "$1" | head -n 1; }
# ver_ge A B: true when A >= B (dotted numbers, missing parts are 0).
ver_ge() {
  _a=$1; _b=$2; _i=1
  while [ "$_i" -le 3 ]; do
    _x=$(printf '%s' "$_a" | cut -d. -f"$_i"); _y=$(printf '%s' "$_b" | cut -d. -f"$_i")
    _x=${_x:-0}; _y=${_y:-0}
    [ "$_x" -gt "$_y" ] && return 0
    [ "$_x" -lt "$_y" ] && return 1
    _i=$((_i + 1))
  done
  return 0
}
NEED=$(engines "$APP/package.json")
INST_NEED=$(engines "$APP/apps/installer/package.json" 2>/dev/null || true)
[ -n "$NEED" ] || die "no engines.node in $APP/package.json"
if [ -n "$INST_NEED" ] && ver_ge "$INST_NEED" "$NEED"; then NEED=$INST_NEED; fi

node_version() { command -v node >/dev/null 2>&1 && node --version 2>/dev/null | sed 's/^v//' || true; }
HAVE=$(node_version)
if [ -n "$HAVE" ] && ver_ge "$HAVE" "$NEED"; then
  ok "node $HAVE (needs $NEED or newer)"
else
  [ -n "$HAVE" ] && say "node $HAVE is older than $NEED" || say "node is not installed (needs $NEED or newer)"
  if command -v brew >/dev/null 2>&1; then
    if [ "$DRY" -eq 1 ]; then
      say "would run: brew install node"
    else
      say "running: brew install node   (Homebrew, user-level)"
      brew install node
      PATH="$(brew --prefix)/bin:$PATH"; export PATH
      hash -r 2>/dev/null || true
      HAVE=$(node_version)
      { [ -n "$HAVE" ] && ver_ge "$HAVE" "$NEED"; } || die "node is still ${HAVE:-missing} after brew install; open a new terminal and rerun ./install.sh"
      ok "node $HAVE"
    fi
  else
    cat >&2 <<FIX
error: Homebrew is not installed, so this script will not install Node for you.
Fix with one line (installs Homebrew, which may ask for your password itself), then rerun ./install.sh:

  /bin/bash -c "\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

Or install Node $NEED or newer from https://nodejs.org (macOS installer) and rerun.
FIX
    exit 1
  fi
fi

# ---- 2. pnpm ---------------------------------------------------------------
if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm $(pnpm --version 2>/dev/null || echo present)"
elif [ "$DRY" -eq 1 ]; then
  say "would run: corepack enable pnpm"
else
  command -v corepack >/dev/null 2>&1 || die "corepack is missing (newer Node builds do not ship it). Fix with one line, then rerun: npm install --global --prefix \"\$HOME/.local\" corepack && export PATH=\"\$HOME/.local/bin:\$PATH\""
  say "running: corepack enable pnpm"
  if ! corepack enable pnpm 2>/dev/null; then
    # The Node folder is not writable without sudo: put the shims in the user's own folder instead.
    say "node's folder is not writable; using ~/.local/bin instead (no sudo)"
    mkdir -p "$HOME/.local/bin"
    corepack enable --install-directory "$HOME/.local/bin" pnpm
    PATH="$HOME/.local/bin:$PATH"; export PATH
    warn "add this line to ~/.zshrc so new terminals find pnpm:  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
  hash -r 2>/dev/null || true
  command -v pnpm >/dev/null 2>&1 || die "pnpm is still not on PATH; open a new terminal and rerun ./install.sh"
  ok "pnpm enabled"
fi

# ---- 3. dependencies -------------------------------------------------------
if [ "$DRY" -eq 1 ]; then
  [ -d "$APP/node_modules" ] && ok "dependencies present" || say "would run: pnpm install --frozen-lockfile (in app/)"
else
  say "running: pnpm install --frozen-lockfile   (in app/)"
  ( cd "$APP" && pnpm install --frozen-lockfile )
  ok "dependencies installed"
fi

# ---- 4. minimal setup ------------------------------------------------------
if [ "$DRY" -eq 1 ] && [ ! -d "$APP/node_modules" ]; then
  say "dependencies are not installed yet, so the dry run stops here; rerun without --dry-run"
  exit 0
fi
if [ -z "${HUB_HOME:-}" ]; then
  printf '\ndependencies are installed. Next: make an instance (@docs/LAYERS.md), then run ./run.sh setup from it (or export HUB_HOME and rerun this script).\n'
  exit 0
fi
say "running: pnpm hub setup${1:+ $*}"
cd "$APP"
if pnpm hub setup "$@"; then
  if [ "$DRY" -eq 1 ]; then say "dry run finished; nothing was written"; else printf '\nready: run hub agent   (or just: hub)\n'; fi
else
  printf '\nsetup left items open (see the table above). Fix them, rerun ./install.sh, then: hub agent\n' >&2
  exit 1
fi
