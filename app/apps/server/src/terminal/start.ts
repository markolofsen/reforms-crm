import type { Repos } from "@hub/db";
import type { HubPaths } from "@hub/config/paths";
import type { RuntimeModes } from "@hub/config/modes";
import { ops } from "@hub/log/ops";
import { createTerminal, serverDetector } from "./terminal";

/**
 * The embedded terminal at start (P49, always on: decision 0032) and the one detector of Claude Code and Codex (P57), shared by the
 * terminal's pick and Agent tools. P66: the readiness check runs now (it sets node-pty's helper bit), not on the first tab.
 */
export function start(o: { repos: Repos; paths: HubPaths; modes: RuntimeModes; adminPort: number; apiPort: number }) {
  const fakeShell = o.modes.shell === "fake";
  const detector = serverDetector({ env: process.env, fake: fakeShell || o.modes.agentTools === "fake" });
  const terminal = createTerminal({ paths: o.paths, repos: o.repos, adminPort: o.adminPort, apiPort: o.apiPort, fakeShell, detector });
  const problem = terminal.warm();
  (problem ? ops("terminal").error : ops("server").info)(`terminal: ${problem ? `cannot start: ${problem.reason} (fix: ${problem.fix})` : fakeShell ? "on, FAKE SHELL (HUB_TERMINAL_SHELL=fake)" : "on (admin origin + ticket only)"}`);
  return { terminal, detector };
}
