import { describe, expect, it } from "vitest";
import { dest, formatDest } from "../src/routes/paths";
import { resolveRoute, searchDest } from "../src/routes/resolve";

// What the retired hash router's test also held (push adds an entry, replace does not, Back lands on the list) is the
// framework's history now; those rules are asserted in a real browser (`e2e/b-routing.spec.ts`, N6). The pure half stays here:
// `searchDest` is what `useSearch`'s set writes (P127 A1).
describe("search state", () => {
  it("a filter is a destination on the same route: it keeps the subject and the other key, and the default drops its key", () => {
    const multi = { project: "x", multi: true };
    const filter = searchDest(resolveRoute("/x/mail", ""), { filter: "waiting" });
    expect(filter && formatDest(filter, multi)).toBe("/x/mail?filter=waiting");
    const back = searchDest(resolveRoute("/x/mail", "filter=waiting"), { filter: "needs_you" });
    expect(back && formatDest(back, multi)).toBe("/x/mail");
    expect(back && formatDest(back, { project: "x", multi: false })).toBe("/mail");
    const conversation = resolveRoute("/mail/c/id-42", "filter=waiting");
    expect(conversation.route === "mail.conversation" && conversation.search.filter).toBe("waiting");
    expect(dest("mail.conversation", { key: "id-42" }, { filter: "waiting" }).search).toEqual({ filter: "waiting" });
  });

  it("keeps the subject and the other key, drops an invalid value to the default, and has no key on other routes", () => {
    const item = resolveRoute("/mail/c/id-3", "filter=all&batch=2");
    expect(searchDest(item, { filter: "zzz" })).toEqual(dest("mail.conversation", { key: "id-3" }, { batch: 2 }));
    expect(searchDest(item, { q: "ana" })).toEqual(dest("mail.conversation", { key: "id-3" }, { filter: "all", batch: 2, q: "ana" }));
    const log = resolveRoute("/log", "kind=skipped&client=4");
    expect(searchDest(log, { client: null })).toEqual(dest("log.list", { kind: "skipped" }));
    expect(searchDest(log, { kind: "drafts" })).toEqual(dest("log.list", { kind: "drafts", client: 4 }));
    expect(searchDest(resolveRoute("/project", ""), { filter: "ready" })).toBeNull();
    expect(searchDest(resolveRoute("/mail", ""), { client: 3 })).toBeNull();
    expect(searchDest(resolveRoute("/nope", ""), { filter: "ready" })).toBeNull();
    expect(searchDest(resolveRoute("/settings", ""), { filter: "all" })).toBeNull();
  });

  it("the two behaviours that are more than setting a key: a lead's view or brand change returns to the Leads list; Sends drops the client", () => {
    const lead = resolveRoute("/mail/leads/0123456789abcdef0123456789abcdef", "view=spam");
    expect(searchDest(lead, { view: "not_now" })).toEqual(dest("mail.leads", { view: "not_now" }));
    expect(searchDest(lead, { brand: "Carapis" })).toEqual(dest("mail.leads", { view: "spam", brand: "Carapis" }));
    expect(searchDest(lead, { q: "bo" })).toBeNull();
    expect(searchDest(resolveRoute("/log", "kind=skipped&client=4"), { kind: "sends" })).toEqual(dest("log.list", { kind: "sends" }));
  });

  it("P84c, P123 U3b: the Messengers channel, view and link state keep each other; an unknown one resets to its default; no other route has a channel", () => {
    const chats = resolveRoute("/messengers", "filter=all&link=hidden&channel=telegram");
    expect(chats.route === "messengers.page" && chats.search.channel).toBe("telegram");
    expect(searchDest(chats, { channel: "whatsapp" })).toEqual(dest("messengers.page", { filter: "all", link: "hidden", channel: "whatsapp" }));
    expect(searchDest(chats, { filter: "waiting" })).toEqual(dest("messengers.page", { filter: "waiting", link: "hidden", channel: "telegram" }));
    expect(searchDest(chats, { link: "linked" })).toEqual(dest("messengers.page", { filter: "all", link: "linked", channel: "telegram" }));
    expect(searchDest(chats, { channel: "fax" })).toEqual(dest("messengers.page", { filter: "all", link: "hidden" }));
    // The old views are no longer views: an address that still says one lists Needs you over every link state.
    const old = resolveRoute("/messengers", "filter=linked");
    expect(old.route === "messengers.page" && old.search.filter).toBe("needs_you");
    expect(old.route === "messengers.page" && old.search.link).toBe("any");
    expect(searchDest(resolveRoute("/mail", ""), { channel: "telegram" })).toBeNull();
  });
});
