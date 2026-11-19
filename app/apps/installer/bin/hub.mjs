#!/usr/bin/env node
// `hub` entry point. Runs the TypeScript CLI through tsx, resolved from THIS package, so it works from any
// folder and through a symlink (the real path of this file is what Node resolves against).
// Started inside an instance without HUB_HOME, it first hands over to that instance's pinned core (src/reexec.ts).
// Before the CLI is loaded, core/app's dependencies are checked (src/deps.ts): a checkout that moved ahead of its
// node_modules (a pin bump, a new workspace package) installs first instead of crashing on an import.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

const [cmd, ...rest] = process.argv.slice(2);
// The prompt hook (P51) starts without the CLI, the hand-over and the dependency check, and must never block a prompt:
// about 0.8 s warm, 1.2 s with a cold tsx cache (measured 2026-11-19). Claude cuts it at 5 s and discards its output
// ("UserPromptSubmit hook timed out after 5s", seen 2026-11-19 at 9.3 s while Mail held AppleEvents and every hub hook ran
// 4-5x slow), so it ends itself, silent and exit 0, at HOOK_DEADLINE_MS after the process started: a late focus line is
// lost, the prompt never waits for the cut. `hub agent` sets HUB_HOME for it.
// A checkout whose dependencies are behind fails this import: that is silence too, never a blocked prompt.
const HOOK_DEADLINE_MS = 3500;
if (cmd === "focus" && rest.includes("--hook")) setTimeout(() => process.exit(0), Math.max(0, HOOK_DEADLINE_MS - process.uptime() * 1000)).unref();
register();
if (cmd === "focus" && rest.includes("--hook")) {
  try {
    await (await import("../src/focus-command.ts")).runFocusHook(process.env, rest);
  } catch {
    /* no focus line */
  }
  process.exit(0);
}
// The session log hook (P54) starts the same way: Codex runs it synchronously, and any failure is silence.
if (cmd === "log" && rest.includes("--hook")) {
  try {
    (await import("../src/log-hook.ts")).runLogHook(rest);
  } catch {
    /* no log line */
  }
  process.exit(0);
}
const { handOver } = await import("../src/reexec.ts");
const next = handOver(process.cwd(), process.env);
if (next) {
  const r = spawnSync(process.execPath, [next.bin, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, HUB_HOME: next.home, HUB_REEXEC: "1" },
  });
  process.exit(r.status ?? (r.signal ? 130 : 1));
}
const { INSTALL, installHint, staleDeps } = await import("../src/deps.ts");
const appDir = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");
const stale = staleDeps(appDir);
if (stale.length) {
  // stderr only: stdout stays the command's own (some print JSON; `hub mcp` speaks the protocol there).
  process.stderr.write(`hub: core/app dependencies are behind the checkout (${stale[0]}${stale.length > 1 ? `, +${stale.length - 1} more` : ""}); installing\n`);
  const r = spawnSync("pnpm", ["--dir", appDir, ...INSTALL], { stdio: ["ignore", process.stderr, process.stderr] });
  if (r.status !== 0) {
    process.stderr.write(`hub: the install failed. Run: \`${installHint(appDir)}\`\n`);
    process.exit(1);
  }
}
// `hub mcp` (P51): the read-only MCP server on stdio, without the CLI (nothing but the protocol may reach stdout).
if (cmd === "mcp" && rest.length === 0) await (await import("@hub/agent/mcp-stdio")).serveHubMcp();
else await import("../src/cli.ts");
