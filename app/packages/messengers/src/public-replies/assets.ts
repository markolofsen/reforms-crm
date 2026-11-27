import { randomBytes } from "node:crypto";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { watchPhotoFolder, type HubPaths } from "@hub/config/paths";
import { watchPhotoAsset, type PublicPhotoAsset } from "@hub/contract/watch-media";
import { photoContainedPath, photoProjectRoot, readPhotoFile } from "./asset-files";
import { describePhoto, PhotoAssetError } from "./image";

export interface VerifiedPublicPhoto { bytes: Uint8Array; mime: PublicPhotoAsset["mime"] }
export interface PublicPhotoAssets {
  read(project: string, photo: PublicPhotoAsset): Promise<VerifiedPublicPhoto>;
  import(project: string, projectRelativePath: string): Promise<PublicPhotoAsset>;
}
const safeError = (error: unknown): never => {
  throw error instanceof PhotoAssetError ? error : new PhotoAssetError("The project photo could not be read or stored.");
};

/** Publish only complete bytes, create-only. A competing import of the same digest may reuse an identical blob. */
async function publish(root: string, folder: string, photo: PublicPhotoAsset, bytes: Buffer): Promise<void> {
  let part = root;
  for (const name of relative(root, folder).split(sep)) {
    part = join(part, name);
    await mkdir(part, { mode: 0o700 }).catch((e: unknown) => {
      if (typeof e !== "object" || e === null || Reflect.get(e, "code") !== "EEXIST") throw e;
    });
    const info = await lstat(part);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new PhotoAssetError("The asset folder must be a regular directory.");
    await photoContainedPath(root, part);
  }
  const temporary = join(folder, `.import-${randomBytes(12).toString("hex")}`);
  const target = join(folder, photo.blobRef);
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await link(temporary, target).catch((e: unknown) => {
      if (typeof e !== "object" || e === null || Reflect.get(e, "code") !== "EEXIST") throw e;
    });
    const stored = await readPhotoFile(root, target);
    if (!stored.equals(bytes)) throw new PhotoAssetError("An existing content-addressed photo does not match its digest.");
  } finally {
    await unlink(temporary);
  }
}

/** One resolver for CLI import, browser preview and the send door; no URL, arbitrary file scheme or absolute path input. */
export function publicPhotoAssets(paths: Pick<HubPaths, "projects">): PublicPhotoAssets {
  return {
    async import(project, source) {
      try {
        const root = await photoProjectRoot(paths, project);
        if (!source || isAbsolute(source) || source.includes("\0") || /^[a-z][a-z0-9+.-]*:/i.test(source)) throw new PhotoAssetError("Import a project-relative image file.");
        const bytes = await readPhotoFile(root, resolve(root, source));
        const photo = await describePhoto(bytes);
        // The configured root may itself be a symlink, so use its real project-relative location after scope validation.
        const folder = resolve(root, relative(join(paths.projects, project), watchPhotoFolder(paths, project)));
        await publish(root, folder, photo, bytes);
        return photo;
      } catch (error) { return safeError(error); }
    },
    async read(project, value) {
      try {
        const parsed = watchPhotoAsset.safeParse(value);
        if (!parsed.success) throw new PhotoAssetError("The reviewed photo descriptor is invalid.");
        const photo = parsed.data;
        const root = await photoProjectRoot(paths, project);
        const folder = resolve(root, relative(join(paths.projects, project), watchPhotoFolder(paths, project)));
        const bytes = await readPhotoFile(root, join(folder, photo.blobRef));
        const actual = await describePhoto(bytes);
        if (actual.sha256 !== photo.sha256 || actual.mime !== photo.mime || actual.bytes !== photo.bytes ||
          actual.width !== photo.width || actual.height !== photo.height) throw new PhotoAssetError("The photo differs from the exact reviewed asset.");
        return { bytes, mime: actual.mime };
      } catch (error) { return safeError(error); }
    },
  };
}
