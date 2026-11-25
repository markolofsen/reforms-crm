import { and, eq, sql } from "drizzle-orm";
import type { FollowUpChannel } from "@hub/config/follow-ups";
import { clientIdentifiers, clients, followUps, messengerChats, type MessengerChannel } from "../schema";
import type { WriteTx } from "../tx";

// The bookkeeping of a plan (decision 0050, P142 verdict 11), in the caller's write transaction. Counts and resets, never a judgement:
// - the reset: the client wrote after the plan was decided (a stored inbound in a linked chat, an inbound Mail the reader keeps), so
//   the plan is `answered`, its count back to 0 and any owner stop cleared. An older message a refill brings is not a reply;
// - the reopen: we wrote after a stop or a hand-over, so the plan waits again with no date (the next sweep lists the client);
// - the count: a draft with `follow_up_n` was sent, so `nudges_sent` and `last_nudge_at` move (a skipped draft never counts).
// Every write changes a row only when a value changes (the `live_*` trigger must not fire for nothing).

type Tx = Pick<WriteTx, "select" | "insert" | "update">;

const KIND = (channel: MessengerChannel) => (channel === "whatsapp" ? "whatsapp" : "telegram");

/** The live client of a linked chat, or null (an unlinked chat has none; a merged one resolves to its survivor). */
export function clientOfChat(tx: Pick<Tx, "select">, project: string, channel: MessengerChannel, chatId: string): number | null {
  const id = tx
    .select({ id: clientIdentifiers.clientId })
    .from(clientIdentifiers)
    .where(and(eq(clientIdentifiers.project, project), eq(clientIdentifiers.kind, KIND(channel)), eq(clientIdentifiers.value, chatId)))
    .get()?.id;
  if (id === undefined) return null;
  const c = tx.select({ id: clients.id, mergedInto: clients.mergedInto }).from(clients).where(eq(clients.id, id)).get();
  return c ? (c.mergedInto ?? c.id) : null;
}

/** The live client of a Mail address of the project, or null. */
export function clientOfEmail(tx: Pick<Tx, "select">, project: string, email: string): number | null {
  const c = tx.select({ id: clients.id, mergedInto: clients.mergedInto }).from(clients).where(and(eq(clients.project, project), eq(clients.email, email.trim().toLowerCase()))).get();
  return c ? (c.mergedInto ?? c.id) : null;
}

const planOf = (tx: Pick<Tx, "select">, project: string, clientId: number) => tx.select().from(followUps).where(and(eq(followUps.project, project), eq(followUps.clientId, clientId))).get() ?? null;

/** The client wrote at `at`. Returns whether the plan moved to `answered`. */
export function followUpClientWrote(tx: Tx, project: string, clientId: number, at: string): boolean {
  const p = planOf(tx, project, clientId);
  if (!p || p.state === "answered") return false;
  // A message from before the decision was already read by the turn that decided it (a refill, an adopted cache row).
  if (at <= p.decidedAt || (p.lastNudgeAt && at <= p.lastNudgeAt)) return false;
  tx.update(followUps)
    .set({ state: "answered", nudgesSent: 0, nextAt: null, waitingOn: null, stopReason: null, updatedAt: new Date().toISOString() })
    .where(eq(followUps.id, p.id))
    .run();
  return true;
}

/** We wrote at `at` (any send, the owner's phone included). A stop or a hand-over decided before it waits again, its count kept. */
export function followUpWeWrote(tx: Tx, project: string, clientId: number, at: string): boolean {
  const p = planOf(tx, project, clientId);
  if (!p || (p.state !== "stopped" && p.state !== "handed_over") || at <= p.decidedAt) return false;
  tx.update(followUps).set({ state: "waiting", nextAt: null, stopReason: null, updatedAt: new Date().toISOString() }).where(eq(followUps.id, p.id)).run();
  return true;
}

/**
 * A nudge was sent (a draft with `follow_up_n`): the count moves once per sent draft. With no plan yet (an attended nudge the owner
 * asked for), a waiting one is made for the agent's next sweep.
 */
export function followUpNudgeSent(tx: Tx, project: string, clientId: number, o: { at: string; n: number; channel: FollowUpChannel }): void {
  const p = planOf(tx, project, clientId);
  const now = new Date().toISOString();
  if (!p) {
    tx.insert(followUps).values({ project, clientId, state: "waiting", nudgesSent: Math.max(1, o.n), lastNudgeAt: o.at, channel: o.channel, decidedBy: "agent", decidedAt: o.at, updatedAt: now }).run();
    return;
  }
  tx.update(followUps)
    .set({ nudgesSent: sql`max(${followUps.nudgesSent} + 1, ${o.n})`, lastNudgeAt: o.at, channel: o.channel, ...(p.state !== "waiting" ? { state: "waiting" as const, nextAt: null } : {}), updatedAt: now })
    .where(eq(followUps.id, p.id))
    .run();
}

/** `last_outbound_at` of a chat moves forward only (ingest's outbound row, the door's send). Returns whether it moved. */
export function noteChatOutbound(tx: Tx, project: string, channel: MessengerChannel, chatId: string, at: string): boolean {
  return (
    tx
      .update(messengerChats)
      .set({ lastOutboundAt: at })
      .where(and(eq(messengerChats.project, project), eq(messengerChats.channel, channel), eq(messengerChats.chatId, chatId), sql`(${messengerChats.lastOutboundAt} is null or ${messengerChats.lastOutboundAt} < ${at})`))
      .run().changes > 0
  );
}
