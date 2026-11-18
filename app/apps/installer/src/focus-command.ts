import { readFileSync } from "node:fs";
import { focusLine, readFocus } from "@hub/agent/focus";
import { hubPaths } from "@hub/config/paths";
import { createRepos, openDbReadOnly } from "@hub/db";
import type { FocusDto } from "@hub/contract/focus";

// `hub focus` (P51): the admin's shared focus as the session bound to `HUB_PROJECT` sees it. `--hook` is the prompt hook of
// both CLIs (Claude and Codex `UserPromptSubmit`): one `additionalContext` line while the focus is fresh, else nothing; any
// error is silence and exit 0, because a hook must never block or slow a prompt. `bin/hub.mjs` starts it without the full CLI.

export async function currentFocus(env: NodeJS.ProcessEnv = process.env): Promise<FocusDto> {
  const paths = hubPaths({ env });
  const handle = openDbReadOnly(paths.db);
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

export async function runFocusHook(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    try { readFileSync(0); } catch { /* no stdin: fine */ }
    const out = hookOutput(await currentFocus(env));
    if (out) process.stdout.write(out + "\n");
  } catch {
    /* silence: no focus line */
  }
}
