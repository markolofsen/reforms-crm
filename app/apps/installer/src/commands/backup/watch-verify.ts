import path from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { backupContained } from "./watch-safe";
import type { ManifestFile } from "./manifest";
import { watchBackupFiles } from "./watch-files";

/** The operator may select a canonical/linked snapshot root; none of its recovery children may be links outside it. */
export function watchBackupRoot(dir: string): string {
  const root = realpathSync(dir);
  if (!lstatSync(root).isDirectory()) throw new Error("The selected snapshot is not a directory");
  for (const relative of ["projects", "state/projects", "data/app.db", "data/watch/_accounts.json"]) backupContained(root, relative, true);
  return root;
}

/** Validate only snapshot files and its copied DB. No live data, policy activation, upload or restore occurs here. */
export function checkWatchBackup(dir: string, recorded: ManifestFile[]): string[] {
  try {
    const root = watchBackupRoot(dir);
    const files = watchBackupFiles({ projects: path.join(root, "projects"), stateProjects: path.join(root, "state", "projects"), watch: path.join(root, "data", "watch") },
      recorded.some((f) => f.path === "data/app.db") ? path.join(root, "data", "app.db") : undefined);
    const entries = new Map(recorded.map((f) => [f.path, f]));
    for (const file of files) {
      const entry = entries.get(file.path);
      if (!entry || entry.sha256 !== file.sha256 || entry.size !== file.size) return [`${file.path}: public-workflow recovery input is missing from or differs from the manifest`];
    }
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "The public-workflow recovery inputs cannot be verified"];
  }
}
