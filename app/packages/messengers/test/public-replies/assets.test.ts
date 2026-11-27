import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WATCH_PHOTO_LIMITS } from "@hub/contract/watch-media";
import { publicPhotoAssets } from "../../src/public-replies/assets";
import { PHOTO, PHOTO_BYTES } from "./photo-fixture";

let dir: string;
let projects: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hub-reviewed-photo-"));
  projects = join(dir, "projects");
  await mkdir(join(projects, "acme.support", "source"), { recursive: true });
  await mkdir(join(projects, "other", "source"), { recursive: true });
  await writeFile(join(projects, "acme.support", "source", "image.png"), PHOTO_BYTES);
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("exact project-local public photo assets", () => {
  it("imports create-only, decodes complete bytes and serves the same digest under the canonical dotted project scope", async () => {
    const assets = publicPhotoAssets({ projects });
    expect(await assets.import("acme.support", "source/image.png")).toEqual(PHOTO);
    expect(await assets.import("acme.support", "source/image.png")).toEqual(PHOTO);
    const result = await assets.read("acme.support", PHOTO);
    expect(Buffer.from(result.bytes)).toEqual(PHOTO_BYTES);
    expect(result).toMatchObject({ mime: "image/png" });
    const folder = join(projects, "acme.support", "assets", "watch-replies");
    expect(await readdir(folder)).toEqual([PHOTO.blobRef]);
    expect(await readFile(join(folder, PHOTO.blobRef))).toEqual(PHOTO_BYTES);
    await expect(assets.read("other", PHOTO)).rejects.toThrow(/could not be read/);
  });

  it("refuses URL/absolute/path escape, links and files that change after the exact review", async () => {
    const assets = publicPhotoAssets({ projects });
    for (const path of ["https://example.test/image.png", "file:source/image.png", join(dir, "outside.png"), "../other/source/image.png"]) {
      await expect(assets.import("acme.support", path)).rejects.toThrow();
    }
    await writeFile(join(dir, "outside.png"), PHOTO_BYTES);
    await symlink(join(dir, "outside.png"), join(projects, "acme.support", "source", "linked.png"));
    await expect(assets.import("acme.support", "source/linked.png")).rejects.toThrow(/symbolic link/);
    await assets.import("acme.support", "source/image.png");
    await writeFile(join(projects, "acme.support", "assets", "watch-replies", PHOTO.blobRef), PHOTO_BYTES.subarray(0, 40));
    await expect(assets.read("acme.support", PHOTO)).rejects.toThrow();
    await expect(assets.import("acme.support", "source/image.png")).rejects.toThrow(/does not match/);
    expect((await readdir(join(projects, "acme.support", "assets", "watch-replies"))).some((name) => name.startsWith(".import-"))).toBe(false);
  });

  it("rejects corrupt/header-only, animated, oversized and non-raster input without publishing a blob", async () => {
    const assets = publicPhotoAssets({ projects });
    const source = join(projects, "acme.support", "source", "bad.png");
    const apng = Buffer.from(PHOTO_BYTES);
    apng.write("acTL", 37, "ascii"); // The only IDAT chunk is now explicitly marked as animation.
    for (const bytes of [PHOTO_BYTES.subarray(0, 33), apng, Buffer.from("<svg><script>bad()</script></svg>"), Buffer.alloc(WATCH_PHOTO_LIMITS.bytes + 1)]) {
      await writeFile(source, bytes);
      await expect(assets.import("acme.support", "source/bad.png")).rejects.toThrow();
    }
    await expect(readdir(join(projects, "acme.support", "assets", "watch-replies"))).rejects.toThrow();
  });

  it("does not accept a caption-only descriptor swap or a provider id as a local asset reference", async () => {
    const assets = publicPhotoAssets({ projects });
    await assets.import("acme.support", "source/image.png");
    await expect(assets.read("acme.support", { ...PHOTO, width: 2 })).rejects.toThrow(/differs/);
    await expect(assets.read("acme.support", { ...PHOTO, mime: "image/jpeg" })).rejects.toThrow(/descriptor/);
    await expect(assets.read("acme.support", { ...PHOTO, blobRef: "../../outside.png" })).rejects.toThrow(/descriptor/);
  });
});
