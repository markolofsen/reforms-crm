import { syncedFolder } from "../setup/situation";
import type { Step } from "../types";
import { fail, pass, warn } from "./helpers";

/** Below this, `pnpm install` and a Next build can fill the disk (P89 verdict 5). */
export const MIN_FREE_GB = 5;

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
    manual: { steps: ["Install Node 22.20 or newer: with nvm `nvm install 22 && nvm alias default 22`, else with Homebrew `brew install node`.", "Open a new terminal and run `node --version`."] },
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
  {
    id: "tools.git", group: "Tools", title: "git",
    why: "An instance is a git repository with the core as a submodule: a teammate joins by cloning it, and the team's config and knowledge arrive with git pull (decision 0043).",
    verifies: "`git --version` answers.",
    async check(ctx) {
      const r = await ctx.run("git", ["--version"]);
      return r.code === 0 ? pass(r.stdout.trim()) : fail("git not found on PATH");
    },
    manual: { steps: ["Run `xcode-select --install` (Apple's command line tools bring git), or `brew install git`."] },
  },
  {
    id: "tools.gh", group: "Tools", title: "GitHub CLI (optional)",
    why: "`hub new-instance` prints the `gh repo create --private` line that makes the instance's private repository; a teammate can clone with plain git.",
    verifies: "`gh --version` answers. Missing is a WARN, never a FAIL.",
    async check(ctx) {
      const r = await ctx.run("gh", ["--version"]);
      return r.code === 0 ? pass(r.stdout.trim().split("\n")[0] ?? "ok") : warn("gh not found: optional, only for making a new instance's repository (`brew install gh`, then `gh auth login`)");
    },
    manual: { steps: ["`brew install gh`, then `gh auth login` with your own GitHub account."] },
  },
  {
    id: "tools.disk", group: "Tools", title: `At least ${MIN_FREE_GB} GB free`,
    why: "Dependencies and the admin's build need several GB; a full disk breaks the install halfway (and on a Mac low disk is often swap).",
    verifies: `\`df -k\` on the instance folder reports ${MIN_FREE_GB} GB or more available. Less is a WARN with the numbers.`,
    async check(ctx) {
      const r = await ctx.run("df", ["-k", ctx.paths.home]);
      const kb = Number(r.stdout.trim().split("\n").pop()?.trim().split(/\s+/)[3]);
      if (r.code !== 0 || !Number.isFinite(kb)) return warn("free space could not be read (df)");
      const gb = kb / 1024 / 1024;
      return gb >= MIN_FREE_GB ? pass(`${gb.toFixed(1)} GB free`) : warn(`${gb.toFixed(1)} GB free, under ${MIN_FREE_GB} GB: free space first (on a Mac check swap: sysctl vm.swapusage)`);
    },
    manual: { steps: ["Free space (empty the Trash, delete old node_modules, check `sysctl vm.swapusage`), then rerun ./run.sh setup."] },
  },
  {
    id: "files.unsynced", group: "Tools", title: "The instance folder is not in a synced cloud folder",
    why: "SQLite over Google Drive, iCloud or Dropbox corrupts, a synced messenger session is a second device on one key (ban risk), and node_modules churns the sync. Drive is for client documents only, through a project's drive.folder (decision 0043).",
    verifies: "The instance folder is not under ~/Library/CloudStorage, ~/Library/Mobile Documents, ~/Google Drive, ~/My Drive, ~/Dropbox, ~/OneDrive or a Google Drive volume.",
    async check(ctx) {
      const hit = syncedFolder(ctx.paths.home);
      return hit ? fail(`${ctx.paths.home} is inside ${hit}: move the folder to a local one (for example ~/workspace), clone it there again, and keep only client documents on Drive`) : pass("local folder");
    },
    manual: { steps: ["Clone the instance again into a local folder: `git clone --recurse-submodules <repo> ~/workspace/hub-<name>`, then `./run.sh setup` there; delete the synced copy once nothing local is left in it."] },
  },
];
