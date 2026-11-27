import { SLUG } from "@hub/contract/refs";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { HubPaths } from "@hub/config/paths";
import { WATCH_PHOTO_LIMITS } from "@hub/contract/watch-media";
import { PhotoAssetError } from "./image";

const inside = (root: string, candidate: string) => {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

export async function photoProjectRoot(paths: Pick<HubPaths, "projects">, project: string): Promise<string> {
  if (!SLUG.test(project) || project.length > 100) throw new PhotoAssetError("Invalid project slug.");
  const root = await realpath(paths.projects);
  const folder = join(root, project);
  const info = await lstat(folder);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new PhotoAssetError("The project must be a regular folder.");
  const real = await realpath(folder);
  if (!inside(root, real)) throw new PhotoAssetError("The project must remain inside the configured projects folder.");
  return real;
}

/** Reject links in every existing component; no user path is passed to the provider or exposed in an error. */
export async function photoContainedPath(root: string, path: string): Promise<string> {
  const candidate = resolve(path);
  if (!inside(root, candidate)) throw new PhotoAssetError("The asset must remain inside its project.");
  let part = root;
  for (const name of relative(root, candidate).split(sep)) {
    part = join(part, name);
    if ((await lstat(part)).isSymbolicLink()) throw new PhotoAssetError("A photo asset cannot be a symbolic link.");
  }
  const real = await realpath(candidate);
  if (!inside(root, real)) throw new PhotoAssetError("The asset must remain inside its project.");
  return real;
}

/** O_NOFOLLOW + descriptor reads keep replacement of the file from swapping the bytes already being validated. */
export async function readPhotoFile(root: string, path: string): Promise<Buffer> {
  const candidate = await photoContainedPath(root, path);
  const file = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || !before.size || before.size > WATCH_PHOTO_LIMITS.bytes) throw new PhotoAssetError("A photo must be a regular file of at most 8 MiB.");
    const buffer = Buffer.alloc(WATCH_PHOTO_LIMITS.bytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await file.stat();
    const current = await stat(await photoContainedPath(root, path));
    if (length > WATCH_PHOTO_LIMITS.bytes || before.size !== length || after.size !== length ||
      before.mtimeMs !== after.mtimeMs || before.ino !== current.ino || before.dev !== current.dev) throw new PhotoAssetError("The photo changed while it was read.");
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}
