import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TerminalStateDto } from "@hub/contract/terminal";
import { TerminalDock, TerminalToggle } from "../src/features/terminal/terminal";
import { TerminalContext, type TerminalModel } from "../src/features/terminal/use-terminal";

// P66 (decision 0032): the terminal has no off state. When no tab can start, the strip and the column are still drawn and
// the column says the reason and the one fix line; while the state loads, the strip is there too.

const problem = { reason: "node-pty does not load on this Node (v24.0.0): ABI mismatch", fix: "pnpm --dir /core/app install --frozen-lockfile" };
const state = (p: TerminalStateDto["problem"]): TerminalStateDto => ({ unattended: false, presets: ["claude", "codex", "shell"], sessions: [], clis: [], checkedAt: null, problem: p });

function model(over: Partial<TerminalModel>): TerminalModel {
  return {
    state: state(null), problem: null, project: "acme", open: false, mounted: false, width: 640, setWidth: () => {}, active: null, setActive: () => {},
    offered: ["claude", "codex", "shell"], clis: [], why: null, full: false, setOpen: () => {}, create: () => {}, creating: false, close: () => {},
    closing: null, notice: null, register: () => {}, patch: () => {}, ...over,
  };
}
const render = (m: TerminalModel, node: ReactNode) => renderToStaticMarkup(<TerminalContext value={m}>{node}</TerminalContext>);

describe("the terminal dock (P66)", () => {
  // The server render is the first render (no DOM here): the strip's 44px box is drawn with a problem and while the state is
  // still loading, but nothing names the terminal until mount (P49: never in the server HTML). The mounted strip and button
  // are held by `e2e/z-terminal.spec.ts` and `e2e/c-console.spec.ts`.
  it("collapsed, before mount: the strip's box is drawn with a problem and while loading; no terminal name in the server HTML", () => {
    for (const m of [model({ state: state(problem), problem }), model({ state: null })]) {
      const strip = render(m, <TerminalDock />);
      expect(strip).toContain('data-slot="terminal-strip"');
      expect(strip).not.toContain("aria-label");
      const toggle = render(m, <TerminalToggle />);
      expect(toggle).toContain('aria-hidden="true"');
      expect(toggle).not.toContain("aria-label");
      expect(toggle).not.toContain("data-terminal-toggle");
    }
  });
  it("open with a problem: the column says the reason and the fix line with its copy button; no start text", () => {
    const html = render(model({ state: state(problem), problem, open: true, mounted: true }), <TerminalDock />);
    expect(html).toContain('data-testid="terminal-problem"');
    expect(html).toContain(`The terminal cannot start: ${problem.reason}.`);
    expect(html).toContain(problem.fix);
    expect(html).toContain(`aria-label="Copy ${problem.fix}"`);
    expect(html).not.toContain("No terminal is running");
  });
  it("open without a problem: the usual empty line, no problem block", () => {
    const html = render(model({ open: true, mounted: true }), <TerminalDock />);
    expect(html).toContain("No terminal is running. Start one with +.");
    expect(html).not.toContain("terminal-problem");
  });
});
