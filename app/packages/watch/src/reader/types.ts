/**
 * The watcher's only door to Telegram (P144 verdict 11): resolve a public username once, read history from a message id, and join
 * a group on the owner's word. Nothing else: no send, no reaction, no mark-read, no member list, no search. A test pins the key
 * set. It is served by the user-account supervisor's existing client (one MTProto connection per session), and its messages go
 * only to the watch store, never into messenger ingest (decision 0049 still reads private chats only).
 */

export interface PublicPeer {
  /** Telegram's id of the group or channel, as text. */
  peerId: string;
  title: string | null;
}

export interface PublicMessage {
  id: number;
  /** null for a channel post or an anonymous admin. */
  senderId: string | null;
  /** `@name` when the sender has a public username. */
  senderHandle: string | null;
  text: string;
  sentAt: string;
}

export type HistoryRead =
  | { ok: true; messages: PublicMessage[] }
  /** Telegram shows this group's history only to members (`join_required`), or not at all (`private`). */
  | { ok: false; reason: "join_required" | "private" };

export type JoinResult = "joined" | "pending";

export interface PublicReader {
  /** The peer of a public username, or null when no public group or channel has it. */
  resolve(username: string): Promise<PublicPeer | null>;
  /** Messages newer than `minId`, oldest first, at most `limit`; read without marking anything read. */
  history(peer: PublicPeer, o: { minId: number; limit: number }): Promise<HistoryRead>;
  /** Joins (or asks to join) one group: only from the owner's Join button. */
  join(peer: PublicPeer): Promise<JoinResult>;
}

/** Telegram's FLOOD_WAIT on any call of the account: the wait it named, in seconds. */
export class FloodWaitError extends Error {
  constructor(readonly seconds: number) {
    super(`Telegram asked this account to wait ${seconds} s (FLOOD_WAIT)`);
    this.name = "FloodWaitError";
  }
}

/**
 * The client does not know a stored peer any more: its access hash lives in the session's own peer cache, which does not
 * survive a restart (saas, 2026-11-25: "Peer -100… is not found in local cache"). The watcher resolves the username again.
 */
export class PeerUnknownError extends Error {
  constructor(readonly peerId: string) {
    super(`the account's client does not know peer ${peerId} (resolve the username again)`);
    this.name = "PeerUnknownError";
  }
}

/** What the watcher knows of the owner's own Telegram work: while it is busy, a watcher call waits (verdict 11). */
export interface OwnerActivity {
  /** Private-chat reads, the autopilot, a send or the restart catch-up in flight on the account. */
  busy(): boolean;
}
