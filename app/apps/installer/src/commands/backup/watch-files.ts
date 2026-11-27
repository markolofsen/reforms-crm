import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { watchPhotoFolder, type HubPaths } from "@hub/config/paths";
import { SLUG } from "@hub/contract/refs";
import { WATCH_PHOTO_LIMITS } from "@hub/contract/watch-media";
import { publicPhotoBackupReferences } from "@hub/db";
import { watchPolicyFile, watchPolicySchema } from "@hub/watch/policy";
import { backupContained, backupHash, backupRead, backupRelative, backupWrite } from "./watch-safe";

type Roots = Pick<HubPaths, "projects" | "stateProjects" | "watch">;
export interface WatchBackupFile { path: string; root: string; relative: string; sha256: string; size: number; limit: number; allowEmpty?: boolean }
const PHOTO_NAME = /^([a-f0-9]{64})\.(jpg|png)$/;
const POLICY_LIMIT = 65_536;
const STRATEGY_LIMIT = 1_048_576;

function projectNames(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!SLUG.test(entry.name) || entry.name.length > 100) return [];
    if (entry.isSymbolicLink()) throw new Error(`${entry.name}: a project backup folder is a symbolic link`);
    return entry.isDirectory() ? [entry.name] : [];
  });
}
const photoKey = (project: string, name: string) => `projects/${project}/assets/watch-replies/${name}`;
function photoHeader(bytes: Buffer, name: string): boolean {
  return name.endsWith(".png") ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}

/** Exact allowlist only. Missing/corrupt pinned inputs or copied-DB asset references refuse the complete snapshot. */
export function watchBackupFiles(paths: Roots, database?: string): WatchBackupFile[] {
  const files = new Map<string, WatchBackupFile>();
  const add = (key: string, root: string, relative: string, limit: number, expected?: string, allowEmpty = false): Buffer => {
    backupRelative(key);
    const bytes = backupRead(root, relative, limit, allowEmpty);
    const sha256 = backupHash(bytes);
    if (expected && sha256 !== expected) throw new Error(`${key}: digest differs from its immutable reference`);
    const previous = files.get(key);
    if (previous && previous.sha256 !== sha256) throw new Error(`${key}: conflicting backup references`);
    files.set(key, { path: key, root, relative, sha256, size: bytes.length, limit, ...(allowEmpty ? { allowEmpty: true } : {}) });
    return bytes;
  };
  const addPhoto = (project: string, name: string): WatchBackupFile => {
    const match = PHOTO_NAME.exec(name);
    if (!match) throw new Error("A public photo backup name must be its canonical digest");
    const key = photoKey(project, name);
    const relative = path.relative(paths.projects, path.join(watchPhotoFolder(paths, project), name)).split(path.sep).join("/");
    const bytes = add(key, paths.projects, relative, WATCH_PHOTO_LIMITS.bytes, match[1]);
    if (!photoHeader(bytes, name)) throw new Error(`${key}: image header does not match the canonical suffix`);
    const result = files.get(key);
    if (!result) throw new Error("Public photo backup entry missing");
    return result;
  };
  // Preserve opaque account counters/FloodWait exactly, without copying locks or interpreting/resetting their schema.
  if (backupContained(paths.watch, "_accounts.json", true)) add("data/watch/_accounts.json", paths.watch, "_accounts.json", 65_536, undefined, true);
  const projects = [...new Set([...projectNames(paths.projects), ...projectNames(paths.stateProjects)])].sort();
  for (const project of projects) {
    const photoRelative = path.relative(paths.projects, watchPhotoFolder(paths, project)).split(path.sep).join("/");
    const folder = backupContained(paths.projects, photoRelative, true);
    if (folder) {
      if (!lstatSync(folder).isDirectory()) throw new Error(`${project}: watch-replies is not a regular directory`);
      for (const name of readdirSync(folder).sort()) if (PHOTO_NAME.test(name)) addPhoto(project, name);
    }
    const policyRelative = path.relative(paths.stateProjects, watchPolicyFile(paths.stateProjects, project)).split(path.sep).join("/");
    if (!backupContained(paths.stateProjects, policyRelative, true)) continue;
    const key = `state/projects/${project}/watch-policy.json`;
    const bytes = add(key, paths.stateProjects, policyRelative, POLICY_LIMIT);
    let raw: unknown;
    try { raw = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${key}: invalid Watch policy JSON`); }
    const policy = watchPolicySchema.safeParse(raw);
    if (!policy.success) throw new Error(`${key}: invalid Watch policy schema`);
    // Revocation is still backed up with its exact pins; this is recovery evidence, never policy activation.
    for (const direction of Object.values(policy.data.directions)) {
      if (!direction.strategy) continue;
      const pinned = backupRelative(direction.strategy.path);
      if (!pinned.endsWith(".md")) throw new Error(`${key}: the pinned strategy is not Markdown`);
      const relative = `${project}/${pinned}`;
      add(`projects/${relative}`, paths.projects, relative, STRATEGY_LIMIT, direction.strategy.sha256);
    }
  }
  if (database && existsSync(database)) {
    for (const ref of publicPhotoBackupReferences(database)) {
      const file = files.get(photoKey(ref.project, ref.photo.blobRef)) ?? addPhoto(ref.project, ref.photo.blobRef);
      if (file.sha256 !== ref.photo.sha256 || file.size !== ref.photo.bytes) throw new Error(`${file.path}: differs from the stored proposal asset descriptor`);
    }
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Re-read after planning so a changed policy cannot silently select a different strategy during the copy. */
export function copyWatchBackupFiles(stage: string, files: WatchBackupFile[]): void {
  for (const file of files) {
    const bytes = backupRead(file.root, file.relative, file.limit, file.allowEmpty);
    if (bytes.length !== file.size || backupHash(bytes) !== file.sha256) throw new Error(`${file.path}: changed since the backup inventory`);
    backupWrite(stage, file.path, bytes, file.limit, file.allowEmpty);
  }
}
