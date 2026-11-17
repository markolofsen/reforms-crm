import { describe, expect, it } from "vitest";
import { searchValue, withSearch } from "../src/hooks/use-search-state";
import { formatDest, paths } from "../src/routes/paths";
import { resolveRoute } from "../src/routes/resolve";

// What the retired hash router's test also held (push adds an entry, replace does not, Back lands on the list) is the
// framework's history now; those rules are asserted in a real browser (`e2e/b-routing.spec.ts`, N6). The pure half stays here.
describe("search state", () => {
  it("a filter is a destination on the same route: it keeps the subject and the other key, and the default drops its key", () => {
    const filter = withSearch(resolveRoute("/drafts", "project=x"), "filter", "hold");
    expect(filter && formatDest(filter, "x")).toBe("/drafts?project=x&filter=hold");
    const back = withSearch(resolveRoute("/drafts", "project=x&filter=hold"), "filter", "ready");
    expect(back && formatDest(back, "x")).toBe("/drafts?project=x");
    expect(searchValue(resolveRoute("/drafts/42", "filter=hold"), "filter")).toBe("hold");
    expect(paths.drafts.item(42, { filter: "hold" }).search).toEqual({ filter: "hold" });
  });

  it("withSearch keeps the subject and the other key, drops an invalid value to the default, and has no key on other routes", () => {
    const item = resolveRoute("/drafts/3", "filter=hold&batch=2");
    expect(withSearch(item, "filter", "zzz")).toEqual(paths.drafts.item(3, { batch: 2 }));
    expect(withSearch(item, "q", "ana")).toEqual(paths.drafts.item(3, { filter: "hold", batch: 2, q: "ana" }));
    const log = resolveRoute("/log", "filter=failed&run=4");
    expect(withSearch(log, "run", null)).toEqual(paths.log.list({ filter: "failed" }));
    expect(withSearch(log, "filter", "ok")).toEqual(paths.log.list({ filter: "ok", run: 4 }));
    expect(withSearch(resolveRoute("/project", ""), "filter", "ready")).toBeNull();
    expect(withSearch(resolveRoute("/drafts", ""), "run", 3)).toBeNull();
    expect(withSearch(resolveRoute("/nope", ""), "filter", "ready")).toBeNull();
  });
});
