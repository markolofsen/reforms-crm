import { describe, expect, it } from "vitest";
import { canonicalAddress, pickProject, REDIRECTS } from "../src/routes/guards";
import { formatDest, paths, routeDest, sectionList, type Dest, type Place } from "../src/routes/paths";
import { formatQuery, parseQuery, positiveInt } from "../src/routes/search";
import { childrenOf, NEXT_ROUTE, SECTIONS } from "../src/routes/sections";
import { STATUS_NEXT } from "@hub/contract/overview";
import { destOf, resolveRoute, type Resolved } from "../src/routes/resolve";

const ONE: Place = { project: "lisbon", multi: false };
const MANY: Place = { project: "lisbon", multi: true };

/** The address text of a destination, read back through the same path the browser takes. */
function roundTrip(d: Dest, place: Place): Resolved {
  const [path = "", search = ""] = formatDest(d, place).split("?");
  return resolveRoute(path, search);
}
const at = (address: string): Resolved => {
  const [path = "", search = ""] = address.split("?");
  return resolveRoute(path, search);
};

describe("resolveRoute", () => {
  it("reads the route, params, search and the project from the first path segment", () => {
    expect(at("/drafts?filter=hold")).toEqual({ route: "drafts.list", section: "drafts", project: null, inPath: false, entry: false, params: {}, search: { filter: "hold", q: "", batch: null } });
    expect(at("/lisbon/drafts/42")).toMatchObject({ route: "drafts.item", project: "lisbon", inPath: true, params: { id: 42 }, search: { filter: "ready", q: "" } });
    expect(at("/lisbon/drafts?batch=3&filter=hold")).toMatchObject({ route: "drafts.list", search: { batch: 3, filter: "hold" } });
    expect(at("/lisbon/log?filter=failed&run=7")).toMatchObject({ route: "log.list", project: "lisbon", search: { filter: "failed", run: 7 } });
    expect(at("/settings")).toMatchObject({ route: "settings.page", section: "settings", project: null, inPath: false });
    expect(at("/demo%20shop/settings")).toMatchObject({ route: "settings.page", project: "demo shop" });
    expect(at("/knowledge")).toMatchObject({ route: "knowledge.page", section: "knowledge", project: null });
    expect(at("/lisbon/settings/mail")).toMatchObject({ route: "settings.mail", section: "settings", project: "lisbon" });
    expect(at("/lisbon/settings/agent")).toMatchObject({ route: "settings.agent", section: "settings", project: "lisbon", search: { filter: "attention" } });
    // P75: the Agent pane's Tools view; a value outside the enum resets to the default.
    expect(at("/settings/agent?filter=all")).toMatchObject({ route: "settings.agent", search: { filter: "all" } });
    expect(at("/settings/agent?filter=nope")).toMatchObject({ route: "settings.agent", search: { filter: "attention" } });
    expect(at("/lisbon/settings/checks")).toMatchObject({ route: "settings.checks", section: "settings", project: "lisbon" });
    expect(at("/settings/connections")).toMatchObject({ route: "settings.connections", section: "settings", project: null });
    expect(at("/settings/mac")).toMatchObject({ route: "settings.mac", section: "settings", project: null });
    // P70: an instance pane reached with a project in mind resolves (the guard folds it), unlike a project before Overview.
    expect(at("/lisbon/settings/connections")).toMatchObject({ route: "settings.connections", project: "lisbon", inPath: true });
    expect(at("/help")).toMatchObject({ route: "help.page", section: "help", project: null });
  });

  it("knows the sections, and the empty address is the entry", () => {
    for (const s of SECTIONS) expect(at(`/${s.id === "log" ? "log" : s.id}`).section).toBe(s.id);
    expect(at("/")).toMatchObject({ route: "drafts.list", entry: true });
  });

  it("an unknown path, the old /clients, a bad id, an extra segment or a project before a projectless section is Not found", () => {
    for (const p of ["/clients", "/nope", "/drafts/abc", "/drafts/0", "/drafts/-1", "/drafts/1.5", "/bulk", "/bulk/3", "/drafts/1/2", "/log/3", "/settings/x", "/settings/mail/1", "/knowledge/x", "/help/x", "/main", "/lisbon", "/lisbon/overview", "/lisbon/help", "/project", "/project/setup", "/agents", "/connections", "/lisbon/project", "/lisbon/agents", "/lisbon/drafts/1/2", "/%E0%A4%A/drafts"]) {
      expect(at(p).route, p).toBe("notFound");
    }
    expect(REDIRECTS).toEqual([]);
  });

  it("a filter outside its enum resets to the default instead of breaking the view", () => {
    expect(at("/drafts?filter=zzz")).toMatchObject({ search: { filter: "ready" } });
    expect(at("/drafts?filter=all")).toMatchObject({ search: { filter: "all" } }); // All is a choice, so it keeps its key
    // Saved links (renamed 2026-11-18): the old `evidence` view value opens the Thin basis view.
    expect(at("/drafts?filter=evidence")).toMatchObject({ search: { filter: "thin_basis" } });
    expect(at("/drafts?filter=sequences")).toMatchObject({ search: { filter: "sequences" } });
    expect(at("/drafts?filter=not_by_email")).toMatchObject({ search: { filter: "not_by_email" } });
    expect(at("/drafts?filter=sequence")).toMatchObject({ search: { filter: "ready" } });
    expect(at("/drafts?batch=abc")).toMatchObject({ search: { batch: null } });
    expect(at("/drafts?batch=0")).toMatchObject({ search: { batch: null } });
    expect(at("/log?filter=nope&run=abc")).toMatchObject({ search: { filter: "all", run: null } });
    expect(at("/knowledge?filter=nope")).toMatchObject({ search: { filter: "all", q: "" } });
    expect(at("/knowledge?filter=attention&q=x")).toMatchObject({ search: { filter: "attention", q: "x" } });
  });
});

describe("paths and places", () => {
  const cases: [string, Dest, string, string][] = [
    ["drafts list", paths.drafts.list(), "/drafts", "/lisbon/drafts"],
    ["drafts hold", paths.drafts.list({ filter: "hold" }), "/drafts?filter=hold", "/lisbon/drafts?filter=hold"],
    ["drafts item", paths.drafts.item(42, { filter: "hold" }), "/drafts/42?filter=hold", "/lisbon/drafts/42?filter=hold"],
    ["a draft of a batch", paths.drafts.item(42, { batch: 3 }), "/drafts/42?batch=3", "/lisbon/drafts/42?batch=3"],
    ["drafts search", paths.drafts.list({ q: "ana" }), "/drafts?q=ana", "/lisbon/drafts?q=ana"],
    ["log run", paths.log.list({ filter: "failed", run: 5 }), "/log?filter=failed&run=5", "/lisbon/log?filter=failed&run=5"],
    ["knowledge", paths.knowledge.page(), "/knowledge", "/lisbon/knowledge"],
    ["knowledge: a view and a search", paths.knowledge.page({ filter: "expired", q: "price" }), "/knowledge?filter=expired&q=price", "/lisbon/knowledge?filter=expired&q=price"],
    ["settings: sending", paths.settings.sending(), "/settings", "/lisbon/settings"],
    ["settings: mail", paths.settings.mail(), "/settings/mail", "/lisbon/settings/mail"],
    ["settings: checks", paths.settings.checks(), "/settings/checks", "/lisbon/settings/checks"],
    ["settings: agent", paths.settings.agent(), "/settings/agent", "/lisbon/settings/agent"],
    ["settings: agent, every tool row", paths.settings.agent({ filter: "all" }), "/settings/agent?filter=all", "/lisbon/settings/agent?filter=all"],
    ["settings: connections", paths.settings.connections(), "/settings/connections", "/settings/connections"],
    ["settings: this mac", paths.settings.mac(), "/settings/mac", "/settings/mac"],
    ["help", paths.help.page(), "/help", "/help"],
    ["overview", paths.overview(), "/overview", "/overview"],
  ];
  for (const [name, d, one, many] of cases) {
    it(`${name}: ${one} with one project, ${many} with several, and both re-parse to the same destination`, () => {
      expect(formatDest(d, ONE)).toBe(one);
      expect(formatDest(d, MANY)).toBe(many);
      expect(destOf(roundTrip(d, ONE))).toEqual(d);
      expect(destOf(roundTrip(d, MANY))).toEqual(d);
      if (many !== one) expect(roundTrip(d, MANY).project).toBe("lisbon");
    });
  }

  it("no address ever carries `?project=`, and a project with a space survives", () => {
    for (const [, d] of cases) for (const place of [ONE, MANY]) expect(formatDest(d, place)).not.toContain("project=");
    expect(roundTrip(paths.drafts.list(), { project: "demo shop", multi: true }).project).toBe("demo shop");
  });

  it("every section has a list destination that resolves to that section; every instance has every section (P70: six parents)", () => {
    for (const s of SECTIONS) expect(roundTrip(sectionList(s.id), MANY).section).toBe(s.id);
    expect(SECTIONS.map((s) => s.id)).toEqual(["overview", "drafts", "log", "knowledge", "settings", "help"]);
    expect(SECTIONS.map((s) => s.chord[1])).toEqual(["o", "d", "a", "k", "s", "h"]);
    expect(SECTIONS.filter((s) => s.phone === "bar").map((s) => s.id)).toEqual(["overview", "drafts", "log", "settings"]);
  });

  it("child pages (P70): Settings' Mail, Agent, Connections, This Mac in order; no other section has one; `g s` lands on Sending", () => {
    expect(childrenOf("settings").map((c) => c.route)).toEqual(["settings.checks", "settings.mail", "settings.agent", "settings.connections", "settings.mac"]);
    for (const s of SECTIONS.filter((x) => x.id !== "settings")) expect(childrenOf(s.id), s.id).toEqual([]);
    expect(sectionList("settings").route).toBe("settings.page");
  });

  it("every place a dot can name maps to a page that resolves (the map is total over the contract)", () => {
    expect(Object.keys(NEXT_ROUTE).sort()).toEqual([...STATUS_NEXT].sort());
    for (const place of STATUS_NEXT) expect(roundTrip(routeDest(NEXT_ROUTE[place]), MANY).route, place).toBe(NEXT_ROUTE[place]);
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

describe("the guard (canonicalAddress, the one normaliser)", () => {
  const canon = (address: string, place: Place) => canonicalAddress(at(address), place, address);
  it("picks the addressed project, else the remembered one, else the first, and only one that exists", () => {
    const list = ["a", "b", "c"];
    expect(pickProject("b", "c", list)).toBe("b");
    expect(pickProject("zzz", "c", list)).toBe("c");
    expect(pickProject(null, "zzz", list)).toBe("a");
    expect(pickProject(null, null, [])).toBeNull();
  });
  it("the entry opens Drafts with one project and Overview with several; Overview is a page on every instance (P63)", () => {
    expect(canon("/", ONE)).toBe("/drafts");
    expect(canon("/", MANY)).toBe("/overview");
    expect(canon("/overview", ONE)).toBeNull();
    expect(canon("/overview", MANY)).toBeNull();
    expect(canon("/lisbon/settings/mail", ONE)).toBe("/settings/mail");
    expect(canon("/settings/agent", MANY)).toBe("/lisbon/settings/agent");
    expect(canon("/help", MANY)).toBeNull();
  });
  it("one project: no project in the address; several: the project in the path", () => {
    expect(canon("/drafts", ONE)).toBeNull();
    expect(canon("/lisbon/drafts/42", ONE)).toBe("/drafts/42");
    expect(canon("/drafts/42?filter=hold", MANY)).toBe("/lisbon/drafts/42?filter=hold");
    expect(canon("/lisbon/drafts/42?filter=hold", MANY)).toBeNull();
    expect(canon("/settings/connections", MANY)).toBeNull();
  });
  it("P70: an instance pane under a project's address folds to the bare form, with one project and with several", () => {
    expect(canon("/lisbon/settings/connections", MANY)).toBe("/settings/connections");
    expect(canon("/lisbon/settings/mac", MANY)).toBe("/settings/mac");
    expect(canon("/lisbon/settings/connections", ONE)).toBe("/settings/connections");
    expect(canon("/settings/mac", ONE)).toBeNull();
  });
  it("saved links of the query era (until 2026-11-18): `?project=` is read once and written back in the path form", () => {
    expect(canon("/drafts/1?project=lisbon", MANY)).toBe("/lisbon/drafts/1");
    expect(canonicalAddress(at("/drafts/1?project=lisbon"), { project: "lisbon", multi: false }, "/drafts/1?project=lisbon")).toBe("/drafts/1");
    expect(at("/drafts/1?project=lisbon").project).toBe("lisbon");
    expect(canon("/settings/connections?project=lisbon", MANY)).toBe("/settings/connections");
  });
  it("a dead filter and the deleted batch builder's `?new=1` (2026-11-18) are dropped; Not found and no project are left alone", () => {
    expect(canon("/drafts?filter=zzz", ONE)).toBe("/drafts");
    expect(canon("/drafts?new=1", ONE)).toBe("/drafts");
    expect(canon("/nope", ONE)).toBeNull();
    expect(canonicalAddress(at("/drafts"), { project: null, multi: false }, "/drafts")).toBeNull();
  });
  it("a rewritten address is stable (no redirect loop)", () => {
    const first = canon("/drafts/3?filter=ready&project=x", { project: "x", multi: true });
    expect(first).toBe("/x/drafts/3");
    expect(canon(first ?? "", { project: "x", multi: true })).toBeNull();
  });
});
