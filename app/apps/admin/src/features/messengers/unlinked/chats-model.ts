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

export const hiddenRows = (st: Pick<AutolinkStateDto, "hidden"> | undefined, channel: MessengerChannelFilter): HiddenDialogDto[] => (st?.hidden ?? []).filter((h) => inChannel(h.channel, channel));

/** The View menu's counts: To do is the linked chats that wait plus the fresh undecided ones; Not linked all the remembered ones; Hidden the ones it can name. */
export function viewCounts(linked: MessengerChatsDto["counts"] | undefined, st: Pick<AutolinkStateDto, "recent" | "unlinked" | "hidden"> | undefined, channel: MessengerChannelFilter): Record<MessengerView, number> | undefined {
  if (!linked) return undefined;
  return { todo: linked.todo + unlinkedRows(st, channel).length, linked: linked.linked, unlinked: notLinkedRows(st, channel).length, hidden: hiddenRows(st, channel).length };
}
