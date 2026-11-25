import { describe, expect, it } from "vitest";
import type { MtPublic } from "@hub/messengers";
import { FloodWaitError, PeerUnknownError } from "@hub/watch/reader";
import { publicReaderOf } from "../../src/watch/reader";

// P144: the server's PublicReader turns the client's errors into the watcher's. No Telegram: a fake MtPublic that throws.

const throwing = (message: string, extra: Record<string, unknown> = {}): MtPublic => {
  const fail = async (): Promise<never> => {
    throw Object.assign(new Error(message), extra);
  };
  return { resolve: fail, history: fail, join: fail };
};
const peer = { peerId: "-1001234567890", title: "G" };

describe("the server's public reader", () => {
  it("a peer the session cache forgot (after a restart) is PeerUnknownError, for history and for join", async () => {
    const mt = throwing("Peer -1001234567890 is not found in local cache");
    await expect(publicReaderOf(mt).history(peer, { minId: 0, limit: 100 })).rejects.toBeInstanceOf(PeerUnknownError);
    await expect(publicReaderOf(mt).join(peer)).rejects.toBeInstanceOf(PeerUnknownError);
    await expect(publicReaderOf(throwing("CHANNEL_INVALID")).history(peer, { minId: 0, limit: 100 })).rejects.toBeInstanceOf(PeerUnknownError);
  });

  it("keeps the other mappings: members only, FLOOD_WAIT", async () => {
    expect(await publicReaderOf(throwing("CHANNEL_PRIVATE")).history(peer, { minId: 0, limit: 100 })).toEqual({ ok: false, reason: "join_required" });
    await expect(publicReaderOf(throwing("FLOOD_WAIT_42", { seconds: 42 })).history(peer, { minId: 0, limit: 100 })).rejects.toBeInstanceOf(FloodWaitError);
  });
});
