import { describe, expect, it } from "vitest";
import { searchValue, withSearch } from "../src/hooks/use-search-state";
import { formatDest, paths } from "../src/routes/paths";
import { resolveRoute } from "../src/routes/resolve";

// What the retired hash router's test also held (push adds an entry, replace does not, Back lands on the list) is the
// framework's history now; those rules are asserted in a real browser (`e2e/b-routing.spec.ts`, N6). The pure half stays here.
describe("search state", () => {
  it("a filter is a destination on the same route: it keeps the subject and the other key, and the default drops its key", () => {
    const multi = { project: "x", multi: true };
    const filter = withSearch(resolveRoute("/x/drafts", ""), "filter", "hold");
    expect(filter && formatDest(filter, multi)).toBe("/x/drafts?filter=hold");
    const back = withSearch(resolveRoute("/x/drafts", "filter=hold"), "filter", "ready");
    expect(back && formatDest(back, multi)).toBe("/x/drafts");
    expect(back && formatDest(back, { project: "x", multi: false })).toBe("/drafts");
    expect(searchValue(resolveRoute("/drafts/42", "filter=hold"), "filter")).toBe("hold");
    expect(paths.drafts.item(42, { filter: "hold" }).search).toEqual({ filter: "hold" });
  });

  it("withSearch keeps the subject and the other key, drops an invalid value to the default, and has no key on other routes", () => {
    const item = resolveRoute("/drafts/3", "filter=hold&batch=2");
    expect(withSearch(item, "filter", "zzz")).toEqual(paths.drafts.item(3, { batch: 2 }));
    expect(withSearch(item, "q", "ana")).toEqual(paths.drafts.item(3, { filter: "hold", batch: 2, q: "ana" }));
    const log = resolveRoute("/log", "filter=skipped&client=4");
    expect(withSearch(log, "client", null)).toEqual(paths.log.list({ filter: "skipped" }));
    expect(withSearch(log, "filter", "drafts")).toEqual(paths.log.list({ filter: "drafts", client: 4 }));
    expect(withSearch(log, "filter", "sends")).toEqual(paths.log.list({ filter: "sends" }));
    expect(withSearch(resolveRoute("/project", ""), "filter", "ready")).toBeNull();
    expect(withSearch(resolveRoute("/drafts", ""), "client", 3)).toBeNull();
    expect(withSearch(resolveRoute("/nope", ""), "filter", "ready")).toBeNull();
  });

  it("P84c: the Messengers channel and view keep each other; an unknown channel resets to All; no other route has a channel", () => {
    const chats = resolveRoute("/messengers", "filter=hidden&channel=telegram");
    expect(searchValue(chats, "channel")).toBe("telegram");
    expect(withSearch(chats, "channel", "whatsapp")).toEqual(paths.messengers.chats({ filter: "hidden", channel: "whatsapp" }));
    expect(withSearch(chats, "filter", "linked")).toEqual(paths.messengers.chats({ filter: "linked", channel: "telegram" }));
    expect(withSearch(chats, "channel", "fax")).toEqual(paths.messengers.chats({ filter: "hidden" }));
    expect(searchValue(resolveRoute("/messengers", "filter=all"), "filter")).toBe("todo");
    expect(withSearch(resolveRoute("/drafts", ""), "channel", "telegram")).toBeNull();
  });
});
