import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Are `core/app`'s dependencies installed for the code on disk? `bin/hub.mjs` asks before it loads the CLI, so a core whose checkout moved
 * ahead of its `node_modules` (a pin bump, a new workspace package) installs first instead of crashing on an import. Node built-ins only:
 * this module runs before anything that a stale install could be missing.
 */

/** `pnpm install` in core/app with the lockfile the checkout carries (never rewrites it). */
export const INSTALL = ["install", "--frozen-lockfile", "--prefer-offline"] as const;

const EXACT = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const readJson = (f: string): Record<string, unknown> | undefined => { try { return JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>; } catch { return undefined; } };

/** The `catalog:` block of a pnpm-workspace.yaml: `name: version` lines, quotes dropped. */
export function readCatalog(yaml: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inside = false;
  for (const line of yaml.split("\n")) {
    if (/^catalog:\s*$/.test(line)) { inside = true; continue; }
    if (inside && /^\S/.test(line)) inside = false;
    const m = inside ? /^\s+['"]?([^'":]+)['"]?:\s*['"]?([^'"\s#]+)['"]?/.exec(line) : null;
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/**
 * What is missing or at the wrong version, one line each, for every workspace member of `appDir` (`apps/*`, `packages/*`).
 * A `workspace:` dependency must be linked; a `catalog:` or exact-version one must be installed at that version; a range is checked for presence only.
 */
export function staleDeps(appDir: string): string[] {
  const out: string[] = [];
  const wsFile = path.join(appDir, "pnpm-workspace.yaml");
  const catalog = existsSync(wsFile) ? readCatalog(readFileSync(wsFile, "utf8")) : {};
  const members = ["apps", "packages"].flatMap((d) => {
    const dir = path.join(appDir, d);
    return existsSync(dir) ? readdirSync(dir).map((n) => path.join(dir, n)).filter((m) => existsSync(path.join(m, "package.json"))) : [];
  });
  for (const member of members) {
    const pkg = readJson(path.join(member, "package.json"));
    if (!pkg) continue;
    const deps = { ...(pkg.dependencies as Record<string, string> | undefined), ...(pkg.devDependencies as Record<string, string> | undefined) };
    for (const [name, spec] of Object.entries(deps)) {
      const where = path.join(member, "node_modules", name, "package.json");
      const label = `${path.relative(appDir, member)}: ${name}`;
      if (!existsSync(where)) { out.push(`${label} is not installed`); continue; }
      const want = spec === "catalog:" ? catalog[name] : EXACT.test(spec) ? spec : undefined;
      const have = want ? (readJson(where)?.version as string | undefined) : undefined;
      if (want && have !== want) out.push(`${label} is ${have ?? "unknown"}, the checkout wants ${want}`);
    }
  }
  return out;
}

/** The one fix line, shown when the install could not run or failed. */
export const installHint = (appDir: string): string => `pnpm --dir ${appDir} ${INSTALL.join(" ")}`;
