import { createHash } from "node:crypto";
import type { PublicPhotoAsset } from "@hub/contract/watch-media";

// One independently encoded 1x1 RGBA PNG; no remote service, model, session or private data.
export const PHOTO_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/ACJozP8EXAJW4ArPbwAAAABJRU5ErkJggg==", "base64");
const sha256 = createHash("sha256").update(PHOTO_BYTES).digest("hex");
export const PHOTO: PublicPhotoAsset = { kind: "photo", blobRef: `${sha256}.png`, sha256,
  mime: "image/png", bytes: PHOTO_BYTES.length, width: 1, height: 1 };
