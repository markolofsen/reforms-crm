import type { MtPublic } from "@hub/messengers";
import { FloodWaitError, PeerUnknownError, type PublicReader } from "@hub/watch/reader";

/**
 * The watcher's `PublicReader` over the user-account supervisor's connection (P144 W4, verdict 10): the account's own session,
 * one MTProto connection, read through `MtPublic` (resolve, history from `minId`, join). Telegram's errors become the reader's:
 * a FLOOD_WAIT on any of these calls is a `FloodWaitError` (the queue parks the watcher), and a history Telegram shows only to
 * members is `join_required`. Not yet checked against a live group: that is W4's five-minute read with the owner present.
 */

const rpcOf = (e: unknown): { text: string; seconds: number | null } => {
  const text = e instanceof Error ? e.message : String(e);
  const raw: unknown = typeof e === "object" && e !== null ? Reflect.get(e, "seconds") : undefined;
  const seconds = typeof raw === "number" ? raw : Number(/FLOOD_WAIT_(\d+)/.exec(text)?.[1] ?? NaN);
  return { text, seconds: Number.isFinite(seconds) ? seconds : null };
};

/** A FLOOD_WAIT as the reader's error; anything else as it was. */
const floodOr = (e: unknown): unknown => {
  const r = rpcOf(e);
  return /FLOOD_WAIT|FLOOD_PREMIUM_WAIT/.test(r.text) ? new FloodWaitError(r.seconds ?? 60) : e;
};

/** mtcute's local refusal of a peer its session cache does not hold (after a restart), and Telegram's for a stale access hash. */
const PEER_UNKNOWN = /not found in local cache|PEER_ID_INVALID|CHANNEL_INVALID/;

const MEMBERS_ONLY = /CHANNEL_PRIVATE|CHAT_FORBIDDEN|CHANNEL_PUBLIC_GROUP_NA/;
const ADMIN_ONLY = /CHAT_ADMIN_REQUIRED/;

export function publicReaderOf(mt: MtPublic): PublicReader {
  return {
    async resolve(username) {
      try {
        const chat = await mt.resolve(username);
        return chat ? { peerId: String(chat.id), title: chat.title } : null;
      } catch (e) {
        throw floodOr(e);
      }
    },
    async history(peer, o) {
      try {
        const rows = await mt.history(Number(peer.peerId), o);
        return { ok: true, messages: rows.map((m) => ({ id: m.id, senderId: m.senderId === null ? null : String(m.senderId), senderHandle: m.senderUsername ? `@${m.senderUsername}` : null, text: m.text, sentAt: m.date.toISOString() })) };
      } catch (e) {
        const r = rpcOf(e);
        if (MEMBERS_ONLY.test(r.text)) return { ok: false, reason: "join_required" };
        if (ADMIN_ONLY.test(r.text)) return { ok: false, reason: "private" };
        if (PEER_UNKNOWN.test(r.text)) throw new PeerUnknownError(peer.peerId);
        throw floodOr(e);
      }
    },
    async join(peer) {
      try {
        return await mt.join(Number(peer.peerId));
      } catch (e) {
        if (/INVITE_REQUEST_SENT/.test(rpcOf(e).text)) return "pending";
        if (PEER_UNKNOWN.test(rpcOf(e).text)) throw new PeerUnknownError(peer.peerId);
        throw floodOr(e);
      }
    },
  };
}
