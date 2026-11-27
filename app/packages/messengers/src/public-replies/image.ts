import { createHash } from "node:crypto";
import sharp from "sharp";
import { WATCH_PHOTO_LIMITS, watchPhotoAsset, type PublicPhotoAsset } from "@hub/contract/watch-media";

export class PhotoAssetError extends Error {}
const bad = (message: string): never => { throw new PhotoAssetError(message); };

/** APNG has a normal PNG signature. Reject its animation chunk before a decoder can select only the first frame. */
function animatedPng(bytes: Buffer): boolean {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) return bad("The PNG is incomplete.");
    if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL") return true;
    offset += size + 12;
  }
  return false;
}

/** Decode for validity and bounds only. The reviewed bytes are never rewritten, resized or stripped after review. */
export async function describePhoto(bytes: Buffer): Promise<PublicPhotoAsset> {
  if (!bytes.length || bytes.length > WATCH_PHOTO_LIMITS.bytes) return bad("A photo must contain at most 8 MiB.");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) return bad("Only a JPEG or PNG raster photo is supported.");
  if (png && animatedPng(bytes)) return bad("Animated images are not supported.");
  try {
    const decoder = sharp(bytes, { limitInputPixels: WATCH_PHOTO_LIMITS.pixels, limitInputChannels: 4, failOn: "warning", sequentialRead: true }).timeout({ seconds: 5 });
    const meta = await decoder.metadata();
    if ((meta.format !== "jpeg" && meta.format !== "png") || (meta.pages ?? 1) !== 1) return bad("Only one still JPEG or PNG photo is supported.");
    const mime = meta.format === "jpeg" ? "image/jpeg" : "image/png";
    if ((png && mime !== "image/png") || (jpeg && mime !== "image/jpeg")) return bad("The image type does not match its contents.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const result = watchPhotoAsset.safeParse({ kind: "photo", blobRef: `${sha256}.${mime === "image/jpeg" ? "jpg" : "png"}`,
      sha256, mime, bytes: bytes.length, width: meta.width, height: meta.height });
    if (!result.success) return bad("The image dimensions exceed the supported bounds.");
    // metadata() alone reads headers; decode the full bounded raster to reject truncation and corrupt input.
    await decoder.raw().toBuffer();
    return result.data;
  } catch (error) {
    if (error instanceof PhotoAssetError) throw error;
    return bad("The photo could not be decoded as a complete bounded JPEG or PNG.");
  }
}
