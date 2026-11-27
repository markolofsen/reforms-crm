import { z } from "zod";

/** Product bounds, independent of Telegram's account tier. One decoded raster is bounded before any upload. */
export const WATCH_PHOTO_LIMITS = { bytes: 8 * 1024 * 1024, edge: 4096, pixels: 16_777_216, aspect: 20, caption: 1024 } as const;

export const watchPhotoAsset = z.strictObject({
  kind: z.literal("photo"),
  blobRef: z.string().regex(/^[a-f0-9]{64}\.(jpg|png)$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mime: z.enum(["image/jpeg", "image/png"]),
  bytes: z.number().int().positive().max(WATCH_PHOTO_LIMITS.bytes),
  width: z.number().int().positive().max(WATCH_PHOTO_LIMITS.edge),
  height: z.number().int().positive().max(WATCH_PHOTO_LIMITS.edge),
}).refine((p) => p.blobRef === `${p.sha256}.${p.mime === "image/jpeg" ? "jpg" : "png"}`, "The blob reference must name these exact bytes and image type.")
  .refine((p) => p.width * p.height <= WATCH_PHOTO_LIMITS.pixels && Math.max(p.width / p.height, p.height / p.width) <= WATCH_PHOTO_LIMITS.aspect, "The photo dimensions exceed the product bounds.");

export type PublicPhotoAsset = z.infer<typeof watchPhotoAsset>;
