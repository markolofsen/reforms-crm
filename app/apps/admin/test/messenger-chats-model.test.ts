import { describe, expect, it } from "vitest";
import { MESSENGER_VIEWS } from "@hub/contract/messenger-panel";
import type { HiddenDialogDto, RecentDialogDto } from "@hub/contract/messengers";
import { unlinkedIntro, unnamedHiddenLine, VIEW_LABEL, VIEW_ORDER, wroteLine } from "../src/features/messengers/labels";
import { channelOptions, effectiveChannel, hiddenRows, unlinkedRows, viewCounts } from "../src/features/messengers/unlinked/chats-model";

// P84c: Messengers ▸ Chats, the channel filter and the three views (owner, 2026-11-20).

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
});
const hid = (chatId: string, channel: HiddenDialogDto["channel"]): HiddenDialogDto => ({ channel, chatId, title: chatId, hiddenAt: "2026-11-20T10:00:00.000Z" });

describe("Chats: channel filter and views", () => {
  it("offers the channel control only with both accounts connected, and an option not offered reads as All", () => {
    expect(channelOptions({ telegram: true, whatsapp: true })).toEqual(["all", "telegram", "whatsapp"]);
    expect(channelOptions({ telegram: true, whatsapp: false })).toEqual([]);
    expect(effectiveChannel("whatsapp", [])).toBe("all");
    expect(effectiveChannel("whatsapp", ["all", "telegram", "whatsapp"])).toBe("whatsapp");
  });

  it("To do counts the linked chats that wait plus the undecided unlinked ones of the channel; suggestions first; Hidden the named ones", () => {
    const st = { recent: [rec("1", "telegram_user"), rec("+62", "whatsapp"), rec("2", "telegram_user", true)], hidden: [hid("3", "telegram_user"), hid("+63", "whatsapp")] };
    expect(unlinkedRows(st, "all").map((r) => r.chatId)).toEqual(["2", "1", "+62"]);
    expect(unlinkedRows(st, "whatsapp").map((r) => r.chatId)).toEqual(["+62"]);
    expect(hiddenRows(st, "telegram").map((h) => h.chatId)).toEqual(["3"]);
    expect(viewCounts({ todo: 1, linked: 4 }, st, "all")).toEqual({ todo: 4, linked: 4, hidden: 2 });
    expect(viewCounts({ todo: 0, linked: 1 }, st, "telegram")).toEqual({ todo: 2, linked: 1, hidden: 1 });
    expect(viewCounts(undefined, st, "all")).toBeUndefined();
    expect(viewCounts({ todo: 0, linked: 0 }, undefined, "all")).toEqual({ todo: 0, linked: 0, hidden: 0 });
  });

  it("names the three views in order, no fourth, and says the unlinked sentence once with its window", () => {
    expect(VIEW_ORDER).toEqual([...MESSENGER_VIEWS]);
    expect(VIEW_ORDER.map((v) => VIEW_LABEL[v])).toEqual(["To do", "Linked", "Hidden"]);
    expect(unlinkedIntro(14)).toMatch(/last 14 days: link one, or hide it if it is not a client\.$/);
    expect(wroteLine({ at: "x", inbound: true }, "2 h ago")).toBe("wrote 2 h ago");
    expect(wroteLine({ at: "x", inbound: false }, "2 h ago")).toBe("you wrote 2 h ago");
    expect(unnamedHiddenLine(1)).toMatch(/^1 more hidden chat is kept as a fingerprint only/);
    expect(unnamedHiddenLine(3)).toMatch(/^3 more hidden chats are/);
  });
});
