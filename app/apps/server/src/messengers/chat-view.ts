import { isHiddenLabel } from "@hub/config/chat-rules";
import { messengerChatDto, messengerDraftDto, type MessengerChatDto } from "@hub/contract/messenger-panel";
import { rulesOf, type MessengerChatRow, type MessengerDraftRow, type MessengerProjectionRow, type Repos } from "@hub/db";
import { type MessengerIdentityResolver } from "./identity";

// P120 W4: a chat's row and its open draft as the panel shows them, built from the repos' rows (route files import no @hub/db).
export const draftOf = (d: MessengerDraftRow) => messengerDraftDto.parse({ id: d.id, text: d.text, createdBy: d.createdBy, nudge: d.nudge, ownerRequest: d.ownerRequest, createdAt: d.createdAt, updatedAt: d.updatedAt });
export const waits = (c: MessengerChatDto): boolean => c.draft !== null || c.owed;
/** Waiting for them (P123 U3b): nothing owed, and the newest message is ours (the admin's `chatState` "waiting"). */
export const waitsForThem = (c: MessengerChatDto): boolean => !waits(c) && c.last !== null && c.last.direction === "out";

/** Maps the bounded DB projection into the same DTO as the detail route without per-chat repository calls. */
export function projectedChatRow(projected: MessengerProjectionRow, identity: MessengerIdentityResolver, slug: string): MessengerChatDto {
  const { row, client, notion, activity, last, lastVerdict } = projected;
  const hidden = isHiddenLabel(lastVerdict) ? lastVerdict : null;
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
    owed: last?.direction === "in" && hidden === null,
    draft: projected.draft ? draftOf(projected.draft) : null,
    autolinked: row.autolinked ?? null,
    triage: projected.triage,
    contact: identity.contact(slug, { email: client?.email ?? null, pageId: notion?.notionPageId ?? null, chat: { channel: row.channel, chatId: row.chatId, own: { username: row.username, phone: row.phone } } }),
  });
}

export async function projectedChatOf(repos: Repos, slug: string, row: MessengerChatRow, identity: MessengerIdentityResolver): Promise<MessengerChatDto | null> {
  const projected = (await repos.messengers.list(slug)).find((item) => item.row.id === row.id);
  return projected ? projectedChatRow(projected, identity, slug) : null;
}
