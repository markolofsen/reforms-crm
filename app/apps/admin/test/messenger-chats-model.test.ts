import { describe, expect, it } from "vitest";
import { MESSENGER_VIEWS } from "@hub/contract/messenger-panel";
import type { HiddenDialogDto, RecentDialogDto } from "@hub/contract/messengers";
import { movedLine, unlinkedHeading, unlinkedIntro, unlinkSentence, unnamedHiddenLine, VIEW_LABEL, VIEW_ORDER, wroteLine } from "../src/features/messengers/labels";
import { channelOptions, effectiveChannel, foldOlder, hiddenRows, linkCounts, notLinkedRows, unlinkedRows, viewCounts } from "../src/features/messengers/unlinked/chats-model";

// P84c: Messengers ▸ Chats, the channel filter and the views (owner, 2026-11-20; P102 adds Not linked).

const rec = (chatId: string, channel: RecentDialogDto["channel"], suggested = false): RecentDialogDto => ({
  channel,
  account: "1",
  chatId,
  title: `Chat ${chatId}`,
  seenAt: "2026-11-20T10:00:00.000Z",
  why: suggested ? "ambiguous" : "none",
  by: suggested ? "phone" : null,
  candidates: suggested ? [{ key: "k", name: "Anna", email: "a@example.test", relationship: null }] : [],
  last: { at: "2026-11-20T10:00:00.000Z", inbound: true },
  username: null,
  phone: null,
});
const hid = (chatId: string, channel: HiddenDialogDto["channel"]): HiddenDialogDto => ({ channel, account: "1", chatId, title: chatId, hiddenAt: "2026-11-20T10:00:00.000Z" });

describe("Chats: channel filter and views", () => {
  it("offers the channel control only with both accounts connected, and an option not offered reads as All", () => {
    expect(channelOptions({ telegram: true, whatsapp: true })).toEqual(["all", "telegram", "whatsapp"]);
    expect(channelOptions({ telegram: true, whatsapp: false })).toEqual([]);
    expect(effectiveChannel("whatsapp", [])).toBe("all");
    expect(effectiveChannel("whatsapp", ["all", "telegram", "whatsapp"])).toBe("whatsapp");
  });

  it("P123 U3b: Needs you counts the linked chats that wait plus the undecided unlinked ones; Waiting only linked chats; All the link state's chats; Hidden only under Hidden", () => {
    const old = rec("9", "telegram_user");
    const st = { recent: [rec("1", "telegram_user"), rec("+62", "whatsapp"), rec("2", "telegram_user", true)], unlinked: [rec("1", "telegram_user"), old, rec("+62", "whatsapp"), rec("2", "telegram_user", true)], hidden: [hid("3", "telegram_user"), hid("+63", "whatsapp")] };
    expect(unlinkedRows(st, "all").map((r) => r.chatId)).toEqual(["2", "1", "+62"]);
    expect(unlinkedRows(st, "whatsapp").map((r) => r.chatId)).toEqual(["+62"]);
    // Not linked keeps the old chat the fresh window drops, suggestions first.
    expect(notLinkedRows(st, "all").map((r) => r.chatId)).toEqual(["2", "1", "9", "+62"]);
    expect(hiddenRows(st, "telegram").map((h) => h.chatId)).toEqual(["3"]);
    const server = { needs_you: 1, waiting: 2, all: 4 };
    expect(viewCounts(server, st, "all", "any")).toEqual({ needs_you: 4, waiting: 2, all: 8 });
    expect(viewCounts(server, st, "all", "linked")).toEqual({ needs_you: 1, waiting: 2, all: 4 });
    expect(viewCounts(server, st, "all", "unlinked")).toEqual({ needs_you: 3, waiting: 0, all: 4 });
    expect(viewCounts(server, st, "all", "hidden")).toEqual({ needs_you: 0, waiting: 0, all: 2 });
    expect(viewCounts({ needs_you: 0, waiting: 1, all: 1 }, st, "telegram", "any")).toEqual({ needs_you: 2, waiting: 1, all: 4 });
    expect(linkCounts(server, st, "all")).toEqual({ any: 8, linked: 4, unlinked: 4, hidden: 2 });
    expect(linkCounts(server, st, "telegram")).toEqual({ any: 7, linked: 4, unlinked: 3, hidden: 1 });
    expect(viewCounts(undefined, st, "all", "any")).toBeUndefined();
    expect(linkCounts(undefined, st, "all")).toBeUndefined();
    expect(viewCounts({ needs_you: 0, waiting: 0, all: 0 }, undefined, "all", "any")).toEqual({ needs_you: 0, waiting: 0, all: 0 });
  });

  it("names the three views in order (P123 U3b: the link state is a filter), and says the unlinked sentence once with its window", () => {
    expect(VIEW_ORDER).toEqual([...MESSENGER_VIEWS]);
    expect(VIEW_ORDER.map((v) => VIEW_LABEL[v])).toEqual(["Needs you", "Waiting", "All"]);
    expect(unlinkedIntro({ freshDays: 14, count: 15, noLinked: false })).toBe("15 new chats of the last 14 days are not linked to a client: link or hide each.");
    // P88: with no linked chat the same one line says so; there is no second paragraph.
    expect(unlinkedIntro({ freshDays: 14, count: 1, noLinked: true })).toBe("No linked chats yet · 1 new chat of the last 14 days is not linked to a client: link or hide each.");
    expect(unlinkedIntro({ freshDays: null, count: 2, noLinked: false })).toBe("2 chats the Hub has seen since it started (any age) are not linked to a client: link or hide each.");
    // P138 verdict 9: the group heading is short; the sentence above is its tooltip.
    expect(unlinkedHeading({ count: 2, noLinked: false })).toBe("Not linked · 2");
    expect(unlinkedHeading({ count: 1, noLinked: true })).toBe("No linked chats yet · Not linked · 1");
    expect(unlinkSentence({ name: "Anna", client: "Anna Lee", stored: 12, hide: false })).toBe("Unlink Anna from Anna Lee: its 12 stored messages and its draft are deleted. Linking again reloads the last 30 days.");
    expect(unlinkSentence({ name: "Anna", client: "Anna Lee", stored: 1, hide: true })).toBe("Unlink and hide Anna (not a client): its 1 stored message and its draft are deleted. The Hub never links it by itself again. Linking again reloads the last 30 days.");
    expect(movedLine({ name: "Anna", to: "Bob" })).toBe("Moved Anna to Bob");
    expect(wroteLine({ at: "x", inbound: true }, "2 h ago")).toBe("wrote 2 h ago");
    expect(wroteLine({ at: "x", inbound: false }, "2 h ago")).toBe("you wrote 2 h ago");
    expect(unnamedHiddenLine(1)).toMatch(/^1 more hidden chat is kept as a fingerprint only/);
    expect(unnamedHiddenLine(3)).toMatch(/^3 more hidden chats are/);
  });
});

// P128 X5: Not linked lists the last 14 days; older chats are one count, and a search folds nothing.
describe("Not linked: older chats fold into a count", () => {
  const now = Date.parse("2026-11-23T12:00:00.000Z");
  const at = (iso: string | null): RecentDialogDto => ({ ...rec(iso ?? "none", "telegram_user"), last: iso === null ? null : { at: iso, inbound: true } });
  const rows = [at("2026-11-22T10:00:00.000Z"), at("2026-11-09T12:00:00.000Z"), at("2026-11-01T10:00:00.000Z"), at(null)];
  it("keeps the chats of the last 14 days and counts the rest, a chat with no message among them", () => {
    const { shown, older } = foldOlder(rows, now, false);
    expect(shown.map((r) => r.last?.at)).toEqual(["2026-11-22T10:00:00.000Z", "2026-11-09T12:00:00.000Z"]);
    expect(older).toBe(2);
  });
  it("folds nothing while a search is typed", () => {
    expect(foldOlder(rows, now, true)).toEqual({ shown: rows, older: 0 });
  });
});
