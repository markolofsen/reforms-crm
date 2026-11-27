import { describe, expect, it } from "vitest";
import { watchActionParam, watchProposalBody, watchReplyBody } from "../src/watch-actions";
import { WATCH_PHOTO_LIMITS, watchPhotoAsset } from "../src/watch/media";

const sha = "a".repeat(64);
const photo = { kind: "photo", blobRef: `${sha}.png`, sha256: sha, mime: "image/png", bytes: 73, width: 1, height: 1 };

describe("exact Watch photo contracts", () => {
  it("accepts only one explicit full-payload or legacy-text confirmation", () => {
    expect(watchReplyBody.parse({ textHash: sha })).toEqual({ textHash: sha });
    expect(watchReplyBody.parse({ payloadHash: sha })).toEqual({ payloadHash: sha });
    for (const body of [{}, { payloadHash: sha, textHash: sha }, { payloadHash: sha, path: "/tmp/photo.png" }]) {
      expect(watchReplyBody.safeParse(body).success).toBe(false);
    }
  });

  it("binds the descriptor to its content address, mime and bounded still-raster dimensions", () => {
    expect(watchPhotoAsset.parse(photo)).toEqual(photo);
    for (const patch of [{ blobRef: "../image.png" }, { blobRef: `${sha}.jpg` }, { mime: "image/svg+xml" },
      { bytes: WATCH_PHOTO_LIMITS.bytes + 1 }, { width: WATCH_PHOTO_LIMITS.edge + 1 }, { width: 21 }, { path: "/tmp/photo.png" }]) {
      expect(watchPhotoAsset.safeParse({ ...photo, ...patch }).success).toBe(false);
    }
  });

  it("takes a canonical project slug and an existing asset descriptor, never a browser file path", () => {
    expect(watchActionParam.parse({ slug: "acme.support" })).toEqual({ slug: "acme.support" });
    const input = { direction: "support", group: "acme_chat", messageId: 42, text: "A reviewed caption", sourceHash: sha, rulesHash: sha,
      photo, review: { ref: "external-review", at: "2026-11-27T10:00:00.000Z", rulesAccepted: true } };
    expect(watchProposalBody.parse(input)).toEqual(input);
    expect(watchProposalBody.safeParse({ ...input, photo: { file: "/tmp/image.png" } }).success).toBe(false);
  });
});
