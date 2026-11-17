import { describe, expect, it } from "vitest";
import { canonicalAddress, pickProject, REDIRECTS } from "../src/routes/guards";
import { formatDest, paths, sectionList, type Dest } from "../src/routes/paths";
import { formatQuery, parseQuery, positiveInt } from "../src/routes/search";
import { SECTIONS } from "../src/routes/sections";
import { destOf, resolveRoute, type Resolved } from "../src/routes/resolve";

/** The address text of a destination, read back through the same path the browser takes. */
function roundTrip(d: Dest, project: string | null): Resolved {
  const [path = "", search = ""] = formatDest(d, project).split("?");
  return resolveRoute(path, search);
}

describe("resolveRoute", () => {
  it("reads the route, params, project and search from the address", () => {
    expect(resolveRoute("/drafts", "project=lisbon&filter=ready")).toEqual({ route: "drafts.list", section: "drafts", project: "lisbon", params: {}, search: { filter: "ready", q: "" } });
    expect(resolveRoute("/drafts/42", "project=lisbon")).toMatchObject({ route: "drafts.item", params: { id: 42 }, search: { filter: "ready", q: "" } });
    expect(resolveRoute("/bulk/3", "project=lisbon&filter=hold")).toMatchObject({ route: "bulk.item", params: { id: 3 }, search: { filter: "hold" } });
    expect(resolveRoute("/bulk", "new=1")).toMatchObject({ route: "bulk.list", search: { new: true } });
    expect(resolveRoute("/log", "filter=failed&run=7")).toMatchObject({ route: "log.list", search: { filter: "failed", run: 7 } });
    expect(resolveRoute("/project", "")).toMatchObject({ route: "project.page", project: null });
  });

  it("knows the five sections and the empty address is Drafts", () => {
    for (const s of SECTIONS) expect(resolveRoute(`/${s.id}`, "").section).toBe(s.id);
    expect(resolveRoute("/", "").route).toBe("drafts.list");
  });

  it("an unknown path, the old /clients, a bad id or an extra segment is Not found, never Drafts", () => {
    for (const p of ["/clients", "/nope", "/drafts/abc", "/drafts/0", "/drafts/-1", "/drafts/1.5", "/bulk/x", "/drafts/1/2", "/log/3", "/project/x", "/main"]) {
      expect(resolveRoute(p, "project=lisbon").route, p).toBe("notFound");
    }
    expect(REDIRECTS).toEqual([]);
  });

  it("a filter outside its enum resets to the default instead of breaking the view", () => {
    expect(resolveRoute("/drafts", "filter=zzz")).toMatchObject({ search: { filter: "ready" } });
    expect(resolveRoute("/drafts", "filter=all")).toMatchObject({ search: { filter: "all" } }); // All is a choice, so it keeps its key
    expect(resolveRoute("/bulk/3", "filter=ready")).toMatchObject({ search: { filter: "all" } }); // a client filter is not a batch filter
    expect(resolveRoute("/log", "filter=nope&run=abc")).toMatchObject({ search: { filter: "all", run: null } });
  });

  it("an empty project is no project", () => {
    expect(resolveRoute("/drafts", "project=").project).toBeNull();
  });
});

describe("paths", () => {
  const cases: [string, Dest, string][] = [
    ["drafts list", paths.drafts.list(), "/drafts?project=lisbon"],
    ["drafts hold", paths.drafts.list({ filter: "hold" }), "/drafts?project=lisbon&filter=hold"],
    ["drafts all", paths.drafts.list({ filter: "all" }), "/drafts?project=lisbon&filter=all"],
    ["drafts item", paths.drafts.item(42, { filter: "hold" }), "/drafts/42?project=lisbon&filter=hold"],
    ["bulk list", paths.bulk.list(), "/bulk?project=lisbon"],
    ["bulk new", paths.bulk.new(), "/bulk?project=lisbon&new=1"],
    ["bulk item", paths.bulk.item(3, { filter: "hold" }), "/bulk/3?project=lisbon&filter=hold"],
    ["log run", paths.log.list({ filter: "failed", run: 5 }), "/log?project=lisbon&filter=failed&run=5"],
    ["project", paths.project.page(), "/project?project=lisbon"],
  ];
  for (const [name, d, href] of cases) {
    it(`${name}: builds ${href} and re-parses to the same destination`, () => {
      expect(formatDest(d, "lisbon")).toBe(href);
      const r = roundTrip(d, "lisbon");
      expect(r.project).toBe("lisbon");
      expect(destOf(r)).toEqual(d);
    });
  }

  it("the default value drops its key, and no project leaves none", () => {
    expect(formatDest(paths.drafts.list({ filter: "ready" }), null)).toBe("/drafts"); // To review is the default
    expect(formatDest(paths.log.list({ filter: "all" }), null)).toBe("/log");
    expect(formatDest(paths.log.list({ run: null }), null)).toBe("/log");
  });

  it("a project name with a space survives the round trip", () => {
    expect(roundTrip(paths.drafts.list(), "demo shop").project).toBe("demo shop");
  });

  it("every section has a list destination that resolves to that section", () => {
    for (const s of SECTIONS) expect(roundTrip(sectionList(s.id), "p").section).toBe(s.id);
  });
});

describe("search helpers", () => {
  it("formatQuery leaves out empty, false and absent values (a default is dropped by the caller)", () => {
    expect(formatQuery({ a: "x", b: "", c: "all", d: false, e: undefined, f: null, g: true, h: 0 })).toBe("?a=x&c=all&g=1&h=0");
    expect(formatQuery({})).toBe("");
  });
  it("parseQuery is flat and the last value wins", () => {
    expect(parseQuery("a=1&a=2&b=%20x")).toEqual({ a: "2", b: " x" });
  });
  it("positiveInt accepts only canonical positive integers", () => {
    expect([positiveInt("3"), positiveInt("0"), positiveInt("007"), positiveInt("3a"), positiveInt(undefined)]).toEqual([3, null, null, null, null]);
  });
});

describe("guards", () => {
  it("picks the addressed project, else the remembered one, else the first, and only one that exists", () => {
    const list = ["a", "b", "c"];
    expect(pickProject("b", "c", list)).toBe("b");
    expect(pickProject("zzz", "c", list)).toBe("c");
    expect(pickProject(null, "zzz", list)).toBe("a");
    expect(pickProject(null, null, [])).toBeNull();
  });
  it("rewrites an address that lacks its project or carries a dead filter; leaves a canonical one and Not found alone", () => {
    const at = (path: string, search: string) => resolveRoute(path, search);
    expect(canonicalAddress(at("/drafts", ""), "lisbon", "/drafts")).toBe("/drafts?project=lisbon");
    expect(canonicalAddress(at("/drafts", "project=lisbon&filter=zzz"), "lisbon", "/drafts?project=lisbon&filter=zzz")).toBe("/drafts?project=lisbon");
    expect(canonicalAddress(at("/", ""), "lisbon", "/")).toBe("/drafts?project=lisbon");
    expect(canonicalAddress(at("/drafts/42", "project=lisbon&filter=hold"), "lisbon", "/drafts/42?project=lisbon&filter=hold")).toBeNull();
    expect(canonicalAddress(at("/nope", ""), "lisbon", "/nope")).toBeNull();
    expect(canonicalAddress(at("/drafts", ""), null, "/drafts")).toBeNull();
  });
  it("Overview is the one cross-project address: it carries no project, and the guard strips one it is given", () => {
    expect(resolveRoute("/overview", "focus=alpha")).toMatchObject({ route: "overview.page", section: "overview", search: { focus: "alpha" } });
    expect(resolveRoute("/overview", "")).toMatchObject({ search: { focus: null } });
    expect(resolveRoute("/overview/x", "")).toMatchObject({ route: "notFound" });
    expect(formatDest(paths.overview({ focus: "alpha" }), "lisbon")).toBe("/overview?focus=alpha");
    expect(formatDest(paths.overview(), "lisbon")).toBe("/overview");
    expect(canonicalAddress(resolveRoute("/overview", ""), "lisbon", "/overview")).toBeNull();
    expect(canonicalAddress(resolveRoute("/overview", "project=lisbon&focus=a"), "lisbon", "/overview?project=lisbon&focus=a")).toBe("/overview?focus=a");
    // Every other section still names its project, so the exemption is one route and not a hole.
    expect(formatDest(paths.drafts.list(), "lisbon")).toBe("/drafts?project=lisbon");
  });
  it("Connections is the second projectless address: no project in it, none added, a stray one stripped", () => {
    expect(resolveRoute("/connections", "")).toMatchObject({ route: "connections.page", section: "connections" });
    expect(resolveRoute("/connections/x", "")).toMatchObject({ route: "notFound" });
    expect(formatDest(paths.connections.page(), "lisbon")).toBe("/connections");
    expect(canonicalAddress(resolveRoute("/connections", ""), "lisbon", "/connections")).toBeNull();
    expect(canonicalAddress(resolveRoute("/connections", "project=lisbon"), "lisbon", "/connections?project=lisbon")).toBe("/connections");
  });
  it("a rewritten address is stable (no redirect loop)", () => {
    const first = canonicalAddress(resolveRoute("/bulk/3", "filter=ready&project=x"), "x", "/bulk/3?filter=ready&project=x");
    expect(first).toBe("/bulk/3?project=x");
    const [path = "", search = ""] = (first ?? "").split("?");
    expect(canonicalAddress(resolveRoute(path, search), "x", `${path}?${search}`)).toBeNull();
  });
});
