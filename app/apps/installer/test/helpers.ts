import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultRunner, defaultRoot, makeCtx, type Ctx, type RunResult, type Runner } from "../src/context.ts";

export interface Call { cmd: string; args: string[]; env?: Record<string, string> }
export interface Fake { ctx: Ctx; calls: Call[]; loaded: Set<string>; home: string; root: string }

/** A throw-away reforms-crm root and HOME. Nothing real is touched; launchctl is faked. */
export function fake(over: { run?: (c: Call) => RunResult | undefined; dryRun?: boolean } = {}): Fake {
  const base = mkdtempSync(path.join(tmpdir(), "hubwf-"));
  const root = path.join(base, "root");
  const home = path.join(base, "home");
  mkdirSync(path.join(root, "config"), { recursive: true });
  mkdirSync(path.join(root, "app", "apps", "installer", "templates"), { recursive: true });
  mkdirSync(home, { recursive: true });
  const real = defaultRoot();
  for (const f of ["config.json", "mcp.json"]) {
    copyFileSync(path.join(real, "app", "apps", "installer", "templates", f), path.join(root, "app", "apps", "installer", "templates", f));
  }
  const calls: Call[] = [];
  const loaded = new Set<string>();
  const realRun = defaultRunner(process.env.PATH ?? "/usr/bin:/bin");
  const run: Runner = async (cmd, args, opts) => {
    const c: Call = { cmd, args, env: opts?.env };
    calls.push(c);
    const o = over.run?.(c);
    if (o) return o;
    if (cmd === "launchctl") {
      const label = args.at(-1)!.split("/").pop()!.replace(/\.plist$/, "");
      if (args[0] === "print") return { code: loaded.has(label) ? 0 : 113, stdout: "", stderr: "" };
      if (args[0] === "print-disabled") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "bootstrap") { loaded.add(path.basename(args[2]!, ".plist")); return { code: 0, stdout: "", stderr: "" }; }
      if (args[0] === "bootout") { loaded.delete(label); return { code: 0, stdout: "", stderr: "" }; }
    }
    return realRun(cmd, args, opts);
  };
  const ctx = makeCtx({ root, home, uid: 501, run, log: () => {}, dryRun: over.dryRun ?? false, pathEnv: process.env.PATH ?? "/usr/bin:/bin" });
  return { ctx, calls, loaded, home, root };
}
