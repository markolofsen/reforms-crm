# @hub/terminal

The server side of the admin's terminal dock: PTY sessions, the fixed presets and the authenticated socket. The contract, the guards
and the presets are owned by `@docs/core/24-terminal.md`; this page is the package's layout.

| File | What |
|---|---|
| `src/presets.ts` | The fixed preset table: `claude` and `codex` spawn `hub agent <slug> --cli <x>` as an argv through the owner's login shell, `shell` is his login shell; the environment a tab gets (`terminalEnv`, minus `SERVER_ONLY_ENV`). The browser names a preset and a project, never a command or a path |
| `src/pty.ts` | node-pty behind an interface, so tests run on a fake; `ensureSpawnHelper` |
| `src/sessions.ts` | `sessionManager`: at most 8 live sessions, each feeding a headless xterm (5 000 lines) so an attach gets the current screen, then the stream; one viewer at a time; sessions end with the server |
| `src/socket.ts` | One socket after the server's upgrade checks: nothing flows before a single-use ticket arrives as the first frame |

Imported by `apps/server` only (the admin draws the terminal with `@hub/ui/product/terminal` and talks over the socket). Off unless
`terminal.enabled: true` in the instance's `config/config.json`. Tests: `pnpm --filter @hub/terminal test`.

Update this page when the architecture changes.
