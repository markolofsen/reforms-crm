import { inChannel, type MessengerChannelFilter, type MessengerChatsDto, type MessengerView } from "@hub/contract/messenger-panel";
import type { AutolinkStateDto, HiddenDialogDto, RecentDialogDto } from "@hub/contract/messengers";

// Messengers ▸ Chats (P84c, owner 2026-11-20): what each view lists and counts, pure so a test holds it (`ui-specifications.md`
// rule 3). The linked chats are the server's (already filtered by channel); the unlinked and the hidden ones are the autolink's
// memory, filtered here by the same channel rule (`inChannel`).

/** The channel options shown: All plus each connected account's. Fewer than two accounts: no control, and the page shows All. */
export function channelOptions(o: { telegram: boolean; whatsapp: boolean }): MessengerChannelFilter[] {
  return o.telegram && o.whatsapp ? ["all", "telegram", "whatsapp"] : [];
}

/** The channel in effect: the address's, unless its option is not shown (an account not connected). */
export const effectiveChannel = (asked: MessengerChannelFilter, options: readonly MessengerChannelFilter[]): MessengerChannelFilter => (options.includes(asked) ? asked : "all");

/** The unlinked chats of To do: the fresh ones the server kept (it drops older ones), in the channel; suggestions first, each newest first. */
export function unlinkedRows(st: Pick<AutolinkStateDto, "recent"> | undefined, channel: MessengerChannelFilter): RecentDialogDto[] {
  const rows = (st?.recent ?? []).filter((r) => inChannel(r.channel, channel));
  return [...rows.filter((r) => r.candidates.length > 0), ...rows.filter((r) => r.candidates.length === 0)];
}

/** P102, Not linked: every unlinked chat the autolink remembers, of any age, in the channel; suggestions first, each newest first. */
export function notLinkedRows(st: Pick<AutolinkStateDto, "unlinked"> | undefined, channel: MessengerChannelFilter): RecentDialogDto[] {
  const rows = (st?.unlinked ?? []).filter((r) => inChannel(r.channel, channel));
  return [...rows.filter((r) => r.candidates.length > 0), ...rows.filter((r) => r.candidates.length === 0)];
}

/** P128 X5 (decision 0045 point 18): Not linked lists the last 14 days, like Mail's To do; older chats are one count. */
export const NOT_LINKED_DAYS = 14;

/**
 * The Not linked rows split by age: `shown` had a message in the last `NOT_LINKED_DAYS` days (or are found by a search, which
 * folds nothing), `older` is how many were left out ("and 44 older, untouched"). A chat with no known last message is older.
 */
export function foldOlder(rows: readonly RecentDialogDto[], now: number, searched: boolean): { shown: RecentDialogDto[]; older: number } {
  if (searched) return { shown: [...rows], older: 0 };
  const since = now - NOT_LINKED_DAYS * 86_400_000;
  const shown = rows.filter((r) => r.last !== null && Date.parse(r.last.at) >= since);
  return { shown, older: rows.length - shown.length };
}

export const hiddenRows = (st: Pick<AutolinkStateDto, "hidden"> | undefined, channel: MessengerChannelFilter): HiddenDialogDto[] => (st?.hidden ?? []).filter((h) => inChannel(h.channel, channel));

const includes = (value: string | null | undefined, query: string): boolean => value?.toLocaleLowerCase().includes(query) ?? false;

export function matchesRecentSearch(row: RecentDialogDto, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return [row.title, row.chatId, row.account, row.username, row.phone, ...row.candidates.flatMap((candidate) => [candidate.name, candidate.email, candidate.relationship])].some((value) => includes(value, q));
}

export function matchesHiddenSearch(row: HiddenDialogDto, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return !q || [row.title, row.chatId, row.account].some((value) => includes(value, q));
}

/** The View menu's counts: To do is the linked chats that wait plus the fresh undecided ones; Not linked all the remembered ones; Hidden the ones it can name. */
export function viewCounts(linked: MessengerChatsDto["counts"] | undefined, st: Pick<AutolinkStateDto, "recent" | "unlinked" | "hidden"> | undefined, channel: MessengerChannelFilter): Record<MessengerView, number> | undefined {
  if (!linked) return undefined;
  return { todo: linked.todo + unlinkedRows(st, channel).length, linked: linked.linked, unlinked: notLinkedRows(st, channel).length, hidden: hiddenRows(st, channel).length };
}
