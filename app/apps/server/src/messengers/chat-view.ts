import { isHiddenLabel } from "@hub/config/chat-rules";
import { messengerChatDto, messengerDraftDto, type ChatSuggestionDto, type MessengerChatDto } from "@hub/contract/messenger-panel";
import { isDoneThrough, rulesOf, type MessengerChatRow, type MessengerDraftRow, type MessengerProjectionRow, type Repos } from "@hub/db";
import { type MessengerIdentityResolver } from "./identity";

// P120 W4: a chat's row and its open draft as the panel shows them, built from the repos' rows (route files import no @hub/db).
export const draftOf = (d: MessengerDraftRow) => messengerDraftDto.parse({ id: d.id, text: d.text, createdBy: d.createdBy, nudge: d.nudge, ownerRequest: d.ownerRequest, createdAt: d.createdAt, updatedAt: d.updatedAt });
export const waits = (c: MessengerChatDto): boolean => c.draft !== null || c.owed;
/** Waiting for them (P123 U3b): nothing owed, and the newest message is ours (the admin's `chatState` "waiting"). */
export const waitsForThem = (c: MessengerChatDto): boolean => !waits(c) && c.last !== null && c.last.direction === "out";

/** P141 U3: the autolink's suggested client records for a chat that is not linked (memory only); none when it runs no autolink. */
export type ChatSuggestions = (channel: MessengerChatRow["channel"], chatId: string) => ChatSuggestionDto[];

/** Maps the bounded DB projection into the same DTO as the detail route without per-chat repository calls. */
export function projectedChatRow(projected: MessengerProjectionRow, identity: MessengerIdentityResolver, slug: string, suggest?: ChatSuggestions): MessengerChatDto {
  const { row, client, notion, activity, last, lastVerdict } = projected;
  const digits = row.phone ?? (row.channel === "whatsapp" && /^\+\d{7,15}$/.test(row.chatId) ? row.chatId.slice(1) : null);
  const hidden = isHiddenLabel(lastVerdict) ? lastVerdict : null;
  // P143 D1: done through the newest inbound message (the cached one or the row's own fact); a newer one reopens it.
  const done = isDoneThrough(row, [activity.lastInAt, row.lastInboundAt].filter((x): x is string => !!x).sort().at(-1) ?? null);
  return messengerChatDto.parse({
    id: row.id,
    channel: row.channel,
    chatId: row.chatId,
    title: row.title,
    client: identity.client(slug, client, notion),
    rules: rulesOf(row),
    inbound: activity.inbound,
    stored: projected.stored,
    last: last ? { direction: last.direction, kind: last.kind, text: last.text, at: last.sentAt, hidden } : null,
    owed: last?.direction === "in" && hidden === null && !done,
    done: done && row.doneAt && row.doneBy ? { at: row.doneAt, by: row.doneBy, reason: row.doneReason } : null,
    draft: projected.draft ? draftOf(projected.draft) : null,
    autolinked: row.autolinked ?? null,
    triage: projected.triage,
    contact: identity.contact(slug, { email: client?.email ?? null, pageId: notion?.notionPageId ?? null, chat: { channel: row.channel, chatId: row.chatId, own: { username: row.username, phone: row.phone } } }),
    identity: {
      phone: digits ? `+${digits.replace(/\D/g, "")}` : null,
      username: row.username,
      profileName: row.profileName,
      firstSeen: row.createdAt,
      account: row.account,
      suggestions: client ? [] : (suggest?.(row.channel, row.chatId) ?? []),
    },
  });
}

export async function projectedChatOf(repos: Repos, slug: string, row: MessengerChatRow, identity: MessengerIdentityResolver, suggest?: ChatSuggestions): Promise<MessengerChatDto | null> {
  const projected = await repos.messengers.projectChat(slug, row.id);
  return projected ? projectedChatRow(projected, identity, slug, suggest) : null;
}
