import { focusLine, readFocus } from "@hub/agent/focus";
import { hubPaths } from "@hub/config/paths";
import { createRepos, openDbReadOnly } from "@hub/db";
import type { FocusDto } from "@hub/contract/focus";

// `hub focus` (P51): the admin's shared focus as the session bound to `HUB_PROJECT` sees it. `--hook` is the prompt hook of
// both CLIs (Claude and Codex `UserPromptSubmit`): one `additionalContext` line while the focus is fresh, else nothing; any
// error is silence and exit 0, because a hook must never block or slow a prompt. `bin/hub.mjs` starts it without the full CLI.

/** The prompt hook's wait on a database lock: past it the hook says nothing (WAL readers normally never wait). */
export const HOOK_BUSY_MS = 250;

export async function currentFocus(env: NodeJS.ProcessEnv = process.env, o: { busyMs?: number } = {}): Promise<FocusDto> {
  const paths = hubPaths({ env });
  const handle = openDbReadOnly(paths.db, o.busyMs === undefined ? {} : { busyMs: o.busyMs });
  try {
    return await readFocus({ file: paths.focus, slug: env.HUB_PROJECT?.trim() || undefined, repos: createRepos(handle.db) });
  } finally {
    handle.close();
  }
}

/** The hook's stdout for a focus, or "" (Claude and Codex read the same `hookSpecificOutput` shape; measured in F0). */
export function hookOutput(f: FocusDto): string {
  const line = focusLine(f);
  return line ? JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: line } }) : "";
}

/**
 * The prompt hook. It also logs the prompt and the focus line it added (P54). The logger is imported lazily in its own try:
 * right after `hub core update`, before an install, `@hub/log` may not resolve, and that must not cost the focus line.
 */
export async function runFocusHook(env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = process.argv): Promise<void> {
  let stdin = "";
  let line: string | null = null;
  try {
    stdin = await readStdin();
    const f = await currentFocus(env, { busyMs: HOOK_BUSY_MS });
    const out = hookOutput(f);
    if (out) { process.stdout.write(out + "\n"); line = focusLine(f); }
  } catch {
    /* silence: no focus line */
  }
  try {
    await (await import("./log-hook")).logPrompt(stdin, cliArg(argv), line, env);
  } catch {
    /* no log line: never a blocked prompt */
  }
}

/**
 * The hook's stdin, read without blocking the event loop (a `readFileSync(0)` would keep `bin/hub.mjs`'s deadline from
 * firing while a CLI holds stdin open). No stdin, or a terminal: "".
 */
export function readStdin(stream: NodeJS.ReadStream = process.stdin): Promise<string> {
  return new Promise((resolve) => {
    if (stream.isTTY) return resolve("");
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (d: string) => (text += d));
    stream.on("end", () => resolve(text));
    stream.on("error", () => resolve(text));
  });
}

/** `--cli claude|codex` of a hook command line; Claude when absent (a session file written before P54). */
export function cliArg(argv: readonly string[]): "claude" | "codex" {
  const i = argv.indexOf("--cli");
  return argv[i + 1] === "codex" ? "codex" : "claude";
}
