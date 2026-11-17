import type { Step } from "../types";
import { fail, pass } from "./helpers";

const semverGte = (v: string, min: [number, number]) => {
  const [a = 0, b = 0] = v.replace(/^v/, "").split(".").map(Number);
  return a > min[0] || (a === min[0] && b >= min[1]);
};

export const toolSteps: Step[] = [
  {
    id: "tools.node", group: "Tools", title: "Node.js 22.20 or newer",
    why: "The installer and the local app run on Node.",
    verifies: "`node --version` reports 22.20 or newer.",
    async check(ctx) {
      const r = await ctx.run("node", ["--version"]);
      if (r.code !== 0) return fail("node not found on PATH");
      return semverGte(r.stdout.trim(), [22, 20]) ? pass(r.stdout.trim()) : fail(`${r.stdout.trim()} is older than 22.20`);
    },
    manual: { steps: ["Install Node 22.20 or newer, for example with nvm: `nvm install 22`.", "Open a new terminal and run `node --version`."] },
  },
  {
    id: "tools.pnpm", group: "Tools", title: "pnpm",
    why: "One package manager for the installer, the app and the packages.",
    verifies: "`pnpm --version` answers.",
    async check(ctx) {
      const r = await ctx.run("pnpm", ["--version"]);
      return r.code === 0 ? pass(r.stdout.trim()) : fail("pnpm not found on PATH");
    },
    manual: { steps: ["Run `corepack enable pnpm` (ships with Node) or `npm i -g pnpm`."] },
  },
  {
    id: "tools.claude", group: "Tools", title: "Claude Code CLI",
    why: "`hub agent` starts your Claude Code session; without the CLI there is no session.",
    verifies: "`claude --version` answers.",
    async check(ctx) {
      const r = await ctx.run("claude", ["--version"]);
      return r.code === 0 ? pass(r.stdout.trim().split("\n")[0] ?? "ok") : fail("claude not found on PATH");
    },
    manual: { steps: ["Install Claude Code from https://claude.com/claude-code and sign in once interactively with `claude`."] },
  },
];
