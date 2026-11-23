# Live edit: an agent changes the admin while you watch

The agent edits `apps/admin` in a worktree on branch `app-live`; Next's dev server hot-reloads; each edit is one commit, so a bad one is one `git revert`.

## How it is wired

- `pnpm live` (from `app/`, main checkout; `scripts/live.sh`) cuts `app-live` from main into a sparse worktree (default `~/.reforms-crm/app-live`), links main's `node_modules`, starts the API if needed and serves the worktree's admin with `next dev -H 127.0.0.1 -p 5273`. It refuses while main has uncommitted admin changes.
- `.claude/settings.json` runs `scripts/live-commit.sh` after every edit tool: only on `app-live`, only the edited file (`git commit --only`), refusing a file outside `app/apps/admin`, with `Live-Edit` and `Session` trailers.
- No `next build` or e2e inside the worktree while its dev server runs.

## Start, undo, keep

```
cd app && pnpm live                                              # terminal 1
cd ~/.reforms-crm/app-live/@projects/reforms-crm/app && claude   # terminal 2: the agent
git -C ~/.reforms-crm/app-live log --oneline main..app-live      # what it did
git -C ~/.reforms-crm/app-live revert <sha>                      # undo one edit
git merge app-live                                               # keep, from main
```

## Limits

- Screens only: `@hub/ui` and the API stay main's; change `packages/ui` in the main checkout with no live session.
- An edit the hook did not see (a shell `sed`, a rename) is committed by hand.
- The hook runs no tests or `tsc`; a new route also needs `next typegen` (the dev server runs it).
