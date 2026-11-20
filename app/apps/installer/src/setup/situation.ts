import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { HubPaths } from "@hub/config/paths";

/**
 * P89 verdict 6: what `hub setup` is looking at, said in one sentence before it does anything.
 *   new      no project was ever set up here (a fresh `new-instance`, or a starter): the project interview is next;
 *   joined   the repo holds a set-up project (someone already ran it) but this Mac has no database: a teammate's first setup;
 *   existing this Mac already runs the instance: a re-run is the doctor plus update hints.
 */
export type Situation = "new" | "joined" | "existing";

const SET_UP = /^\|\s*(setup\.completed\s*\|\s*\d{4}-\d{2}-\d{2}|status\s*\|\s*(active|paused))\b/m;

/** Project folders (`projects/<slug>/project.md`, not `_` or `.`), and which of them someone already set up. */
export function projectsOf(projectsDir: string): { slug: string; setUp: boolean }[] {
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
    .flatMap((e) => {
      const f = path.join(projectsDir, e.name, "project.md");
      if (!existsSync(f)) return [];
      return [{ slug: e.name, setUp: SET_UP.test(readFileSync(f, "utf8")) }];
    });
}

export function situationOf(paths: Pick<HubPaths, "db" | "projects">): { situation: Situation; sentence: string } {
  const projects = projectsOf(paths.projects);
  const names = projects.map((p) => p.slug).join(", ");
  if (existsSync(paths.db)) {
    return { situation: "existing", sentence: `This Mac already runs this instance${names ? ` (${names})` : ""}: checking everything, fixing what a script may fix, then what is new.` };
  }
  if (projects.some((p) => p.setUp)) {
    return { situation: "joined", sentence: `You are joining an instance the team already set up (${names}): the shared part came with the repo; this sets up your Mac and lists what only you can do here.` };
  }
  return { situation: "new", sentence: projects.length ? `A new instance with a project not set up yet (${names}): this sets up your Mac; then the project interview fills the rest.` : "A new instance with no project yet: this sets up your Mac; then a session creates the first project." };
}

export { personFile, personProblem, readPerson, writePerson, type Person } from "@hub/config/person";

/** Folders a cloud client syncs (P89 verdict 15): an instance there corrupts SQLite and copies sessions. */
export function syncedFolder(dir: string, home: string = homedir()): string | undefined {
  const real = path.resolve(dir);
  const roots = [
    path.join(home, "Library", "CloudStorage"),
    path.join(home, "Library", "Mobile Documents"),
    path.join(home, "Google Drive"),
    path.join(home, "My Drive"),
    path.join(home, "Dropbox"),
    path.join(home, "OneDrive"),
  ];
  const hit = roots.find((r) => real === r || real.startsWith(`${r}${path.sep}`));
  if (hit) return hit;
  // iCloud's "Desktop & Documents" sync cannot be seen from the path; a Drive mounted under /Volumes can.
  if (/^\/Volumes\/(GoogleDrive|Google Drive)\b/.test(real)) return real.split(path.sep).slice(0, 3).join(path.sep);
  return undefined;
}
