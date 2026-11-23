import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { draftCountsReadOnly } from "@hub/db";
import { CORE_ROOT, findInstanceHome, hubPaths, INSTANCE_MARKER, instancePorts } from "@hub/config/paths";
import { projectStore } from "@hub/projects/store";
import { portBusy } from "./net";
import { readPinFile } from "@hub/config/core-version";

export interface InstanceStatus {
  name: string;
  home: string;
  /** The pin as written (tag or commit), and whether the instance follows main. */
  pin: string;
  follows: boolean;
  /** What `core/` is at: a tag, a short commit, `missing`, or `dirty` suffix; `drift` when it differs from the pin. */
  core: string;
  drift: boolean;
  projects: { slug: string; status: string }[];
  /** Drafts per status (`ready` is what waits for the owner), `null` without a database. */
  drafts: Record<string, number> | null;
  ports: { admin: number; api: number } | null;
  running: boolean;
}

export interface StatusDeps {
  git: (cwd: string, args: string[]) => string | undefined;
  busy: (port: number) => Promise<boolean>;
}

const realGit = (cwd: string, args: string[]): string | undefined => {
  try { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return undefined; }
};

/** Instances to report: the roots given, else the folders next to the core in use; plus the instance the current folder is inside. Only folders with `core.version`. */
export function findInstances(roots: string[], cwd: string = process.cwd(), core: string = CORE_ROOT): string[] {
  const dirs = new Set<string>();
  const here = findInstanceHome(cwd);
  if (here) dirs.add(here);
  for (const root of roots.length ? roots : [path.dirname(core)]) {
    if (!existsSync(root)) continue;
    if (existsSync(path.join(root, INSTANCE_MARKER))) dirs.add(path.resolve(root));
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith(".") && existsSync(path.join(root, e.name, INSTANCE_MARKER))) dirs.add(path.resolve(root, e.name));
    }
  }
  return [...dirs].sort();
}

export async function instanceStatus(home: string, deps: Partial<StatusDeps> = {}): Promise<InstanceStatus> {
  const git = deps.git ?? realGit;
  const busy = deps.busy ?? portBusy;
  const file = readPinFile(home);
  const pin = file?.pin ?? "none";
  const follows = file?.follows === "main";
  const coreDir = path.join(home, "core");
  let core = "missing", drift = false;
  if (existsSync(path.join(coreDir, ".git")) || existsSync(path.join(coreDir, "hub.sh"))) {
    const head = git(coreDir, ["rev-parse", "HEAD"]);
    const tag = git(coreDir, ["describe", "--tags", "--exact-match"]);
    const dirty = (git(coreDir, ["status", "--porcelain"]) ?? "") !== "";
    core = `${tag ?? head?.slice(0, 9) ?? "unknown"}${dirty ? " dirty" : ""}`;
    const pinSha = pin !== "none" ? git(coreDir, ["rev-parse", `${pin}^{commit}`]) : undefined;
    drift = !!head && !!pinSha && head !== pinSha;
  }
  let paths: ReturnType<typeof hubPaths> | undefined;
  let ports: InstanceStatus["ports"] = null;
  try { paths = hubPaths({ env: {}, home }); ports = instancePorts(paths, {}); } catch { /* a malformed config: shown as no ports */ }
  let projects: InstanceStatus["projects"] = [];
  try { projects = projectStore({ projects: path.join(home, "projects") }).list().map((p) => ({ slug: p.slug, status: p.parsed.config.status })); } catch { /* unreadable project.md: doctor says why */ }
  return {
    name: path.basename(home), home, pin: pin.length > 12 ? pin.slice(0, 9) : pin, follows, core, drift, projects,
    drafts: paths ? draftCountsReadOnly(paths.db) : null,
    ports,
    running: ports ? await busy(ports.admin) : false,
  };
}

export function statusTable(rows: InstanceStatus[]): string {
  const head = ["instance", "core", "pin", "projects", "drafts ready", "admin"];
  const body = rows.map((r) => [
    r.name,
    r.core + (r.drift ? " (differs from pin)" : ""),
    r.follows ? `${r.pin} (follows main)` : r.pin,
    r.projects.length ? r.projects.map((p) => `${p.slug}:${p.status}`).join(", ") : "none",
    r.drafts === null ? "no database" : String(r.drafts.ready ?? 0),
    r.ports ? `${r.ports.admin}${r.running ? " up" : ""}` : "bad config",
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(w[i]!)).join("  ").trimEnd();
  return [line(head), ...body.map(line)].join("\n");
}
