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

  it("the two behaviours that are more than setting a key: a lead's view change returns to the list; Sends drops the client", () => {
    const lead = resolveRoute("/mail/lead/0123456789abcdef0123456789abcdef", "q=ana");
    expect(searchDest(lead, { filter: "waiting" })).toEqual(dest("mail.list", { filter: "waiting", q: "ana" }));
    expect(searchDest(lead, { q: "bo" })).toEqual(dest("mail.lead", { page: "0123456789abcdef0123456789abcdef" }, { q: "bo" }));
    expect(searchDest(resolveRoute("/log", "kind=skipped&client=4"), { kind: "sends" })).toEqual(dest("log.list", { kind: "sends" }));
  });

  it("P84c: the Messengers channel and view keep each other; an unknown channel resets to All; no other route has a channel", () => {
    const chats = resolveRoute("/messengers", "filter=hidden&channel=telegram");
    expect(chats.route === "messengers.page" && chats.search.channel).toBe("telegram");
    expect(searchDest(chats, { channel: "whatsapp" })).toEqual(dest("messengers.page", { filter: "hidden", channel: "whatsapp" }));
    expect(searchDest(chats, { filter: "linked" })).toEqual(dest("messengers.page", { filter: "linked", channel: "telegram" }));
    expect(searchDest(chats, { channel: "fax" })).toEqual(dest("messengers.page", { filter: "hidden" }));
    const old = resolveRoute("/messengers", "filter=all");
    expect(old.route === "messengers.page" && old.search.filter).toBe("todo");
    expect(searchDest(resolveRoute("/mail", ""), { channel: "telegram" })).toBeNull();
  });
});
