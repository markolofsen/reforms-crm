import type { MessengerChatRow, Repos } from "@hub/db";
import type { DraftWriter, InboundMessage } from "@hub/mail-app/writer/types";
import { bookingFor, bookingMismatch, bookingMismatchMessage, bookingOffers, brandForKey, type BookingConfig, type BookingView } from "@hub/projects/brands";
import { ToolError } from "../mcp/result";
import type { DraftScope } from "./sign";

// P155: the booking link of one thread as the hub MCP tools hand it to the agent (verdict 7) and check it at the write (verdict 8).
// The resolver and the check are `@hub/projects/brands` (booking.ts); this file reads the thread they judge: the answered mail
// from Mail (the Hub keeps no mail text, decision 0013) and a chat's stored messages.

/** The view as a tool returns it: the link to use literally, or none, and the one-line rule. */
export const bookingOut = (v: BookingView) => ({ url: v.url, alreadyOffered: v.alreadyOffered, reason: v.reason });

/**
 * A client's brand where no mail header says it (a chat, a sweep turn): the newest recorded mail draft of the client that
 * carried a brand of this project, else the brand of the newest lead of the client's email, else null (verdict 4's fallback).
 */
export async function clientBrand(repos: Repos, slug: string, clientId: number | null | undefined, c: Pick<BookingConfig, "brands">): Promise<string | null> {
  if (clientId === null || clientId === undefined || c.brands.length === 0) return null;
  for (const d of await repos.drafts.ofClient(slug, clientId).catch(() => [])) {
    const row = d.brand ? brandForKey(c.brands, d.brand) : null;
    if (row) return row.name;
  }
  const email = (await repos.clients.get(slug, clientId).catch(() => null))?.email;
  if (!email) return null;
  const lead = (await repos.leadRows.ofEmail(slug, email).catch(() => [])).find((l) => l.brand && brandForKey(c.brands, l.brand));
  return lead?.brand ? (brandForKey(c.brands, lead.brand)?.name ?? null) : null;
}

/** The answered message's text as Mail gives it (with the thread it quotes); null when Mail does not answer. */
export const mailText = (writer: DraftWriter, inbound: InboundMessage): Promise<string | null> => writer.readContent(inbound).catch(() => null);

/** A chat's stored messages, ours and theirs (the open draft is not one of them: a revision never counts itself). */
export async function chatTexts(repos: Repos, slug: string, row: Pick<MessengerChatRow, "channel" | "chatId">): Promise<{ ours: string[]; theirs: string[] }> {
  const msgs = await repos.messengers.messagesOf(slug, [{ channel: row.channel, chatId: row.chatId }], { limit: 500 });
  return { ours: msgs.filter((m) => m.direction === "out").map((m) => m.text ?? ""), theirs: msgs.filter((m) => m.direction !== "out").map((m) => m.text ?? "") };
}

/** One chat's view: its client's brand, the offers in its stored messages. */
export async function chatBooking(repos: Repos, slug: string, row: Pick<MessengerChatRow, "channel" | "chatId">, clientId: number | null, c: BookingConfig, o: { followUp?: boolean } = {}): Promise<{ view: BookingView; theirs: string[] }> {
  const brand = await clientBrand(repos, slug, clientId, c);
  const t = await chatTexts(repos, slug, row);
  return { view: bookingFor(c, brand, bookingOffers(t.ours, c), o), theirs: t.theirs };
}

/** Verdict 8: refuses the agent's text when it carries a booking link this thread may not (`booking_link_mismatch`). */
export function refuseBookingMismatch(c: BookingConfig, text: string, view: BookingView, clientTexts: readonly (string | null)[]): void {
  const found = bookingMismatch(text, c, view.url, clientTexts);
  if (found) throw new ToolError("booking_link_mismatch", bookingMismatchMessage(found, view));
}

/**
 * Verdict 8 at `draft_write` (reply, new, revise), after the writer resolved the brand and before Mail is asked. A text with no
 * booking-like URL passes without reading Mail; otherwise the answered message (and the thread it quotes) is read to count the
 * offers and to find a scheduler link the client wrote themselves. Mail unreadable: counted as not offered (the owner sends mail).
 */
export async function mailBookingGuard(s: DraftScope, text: string, brand: string | null, inbound: InboundMessage | null | (() => Promise<InboundMessage | null>), o: { followUp?: boolean } = {}): Promise<void> {
  const c = s.cfg;
  if (bookingMismatch(text, c, null) === null) return;
  const m = typeof inbound === "function" ? await inbound().catch(() => null) : inbound;
  const thread = m ? await mailText(s.writer, m) : null;
  refuseBookingMismatch(c, text, bookingFor(c, brand, bookingOffers([thread], c), o), [thread]);
}
