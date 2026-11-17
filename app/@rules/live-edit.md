# Live edit: an agent changes the admin app while you watch

The agent edits `apps/admin`; Next's dev server (Turbopack) hot-reloads the page; each edit is one git commit on
branch `app-live`, so a bad one is one `git revert`. Built 2026-11-14 (P3); the Next form was proved in the
P32 N0 spike (symlinked `node_modules`, HMR in 0.9 s without a full reload) and is what this page describes.

## How it is wired

- `pnpm live` (from `app/`, main checkout) runs `scripts/live.sh`. It cuts branch `app-live` from main's HEAD into a
  separate worktree (default `~/.reforms-crm/app-live`, sparse: only `apps/admin`, `packages/ui`, `scripts`, `.claude`), links main's
  `node_modules` into it, starts the API if it is not running, and serves **the worktree's** admin app with
  `next dev -H 127.0.0.1 -p 5273` on http://127.0.0.1:5273 (`hub up` keeps 5173). `packages/*` and
  the API stay main's: the loop only changes the UI. `packages/ui` is in the worktree only so Tailwind finds the stylesheet the admin imports.
- The Next specifics, all in `next.config.ts` and the script's environment: `HUB_NEXT_ROOT` is set to a directory that
  contains both the worktree and the main checkout (the real layout: `$HOME`), because Turbopack follows the symlinked
  `node_modules` only when its root is a common ancestor (otherwise: "Could not find the Next.js package"); the
  worktree has its own git-ignored `.next`; `-H 127.0.0.1` is never left out (without it the dev server is reachable
  from the LAN); `HUB_PORT` points the `/api` rewrite at the API the script started.
- `.claude/settings.json` runs `scripts/live-commit.sh` after every `Edit`, `Write` and `MultiEdit`. The hook:
  - acts only in a checkout whose branch is `app-live`; in the main checkout it does nothing;
  - commits only the one edited file, with `git commit --only` (the index and other files are never swept);
  - refuses (exit 2, the agent sees why) a file outside `app/apps/admin`: nothing is committed;
  - refuses while the main checkout has uncommitted changes under `app/apps/admin`;
  - builds the subject from the tool input (`admin: Edit src/features/shell/shell.tsx: "Workflow" -> "Hub"`), and adds `Live-Edit` and
    `Session` trailers.
- `pnpm live` itself refuses to start while main has uncommitted changes under `apps/admin`. If `app-live` has no
  commits it follows main on each start; if it has commits, it keeps them.
- Never run `next build` or the e2e suite inside the worktree while its dev server runs: they share `.next` unless
  `HUB_NEXT_DIST` names another directory (`verification.md` rule 6).

## Start a session

```
cd app && pnpm live                      # terminal 1: prints the URL and the worktree path
cd ~/.reforms-crm/app-live/@projects/reforms-crm/app && claude     # terminal 2: the agent
```

The agent must start in the worktree (its `.claude/settings.json` carries the hook). Rules for it are the rest of
`app/@rules/`; the hook enforces scope, not taste.

## Undo and keep

```
git -C ~/.reforms-crm/app-live log --oneline main..app-live      # what the agent did, newest first
git -C ~/.reforms-crm/app-live revert <sha>                      # undo one edit (a new commit; the page reloads)
git merge app-live                                                # from the main checkout: keep the edits
```

After the merge, `pnpm live` follows main again. To throw everything away:
`git worktree remove --force ~/.reforms-crm/app-live && git branch -D app-live`.

## Limits

- The loop edits screens, not primitives or tokens: `@hub/ui` resolves to main's copy through the symlinked `node_modules`, and the hook refuses a path outside `apps/admin`. Change `packages/ui` in the main checkout, with no live session running.
- Edits to a file the hook did not see (a shell `sed`, a rename) are not committed; commit them by hand in the worktree.
- A multi-file change is several commits; revert them together with `git revert <old>..<new>`.
- The hook never runs tests or `tsc` (builds happen once, at the end of a piece of work). A half-done edit can break
  the page until the next edit; the Next error overlay shows it. A new route file or a changed `paths.ts` also
  needs `next typegen` (the dev server runs it on its own) before `tsc` agrees.
- `scripts/live-commit.sh` needs only `bash`, `git` and `node`.
