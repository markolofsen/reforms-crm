import { describe, expect, it } from "vitest";
import { canonicalAddress, pickProject, REDIRECTS } from "../src/routes/guards";
import { formatDest, dest, sectionList, type Dest, type Place } from "../src/routes/paths";
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

/** The section's name before P96 (Drafts): its addresses are gone, with no redirect (no legacy aliases). */
const OLD = "drafts";

describe("resolveRoute", () => {
  it("reads the route, params, search and the project from the first path segment", () => {
    expect(at("/mail?filter=waiting")).toEqual({ route: "mail.list", section: "mail", project: null, inPath: false, entry: false, params: {}, search: { filter: "waiting", q: "", batch: null, m: null } });
    // P99, P103: a conversation is a client key under /mail/c/ (his email, or id-<n>); `?m=` names one of their messages.
    expect(at("/mail/c/Ana%40Example.com")).toMatchObject({ route: "mail.conversation", params: { key: "ana@example.com" } });
    expect(at("/lisbon/mail/c/id-42")).toMatchObject({ route: "mail.conversation", project: "lisbon", inPath: true, params: { key: "id-42" }, search: { filter: "needs_you", q: "" } });
    expect(at("/mail/c/id-7?filter=all&m=abc%40mail.example")).toMatchObject({ route: "mail.conversation", project: null, params: { key: "id-7" }, search: { filter: "all", m: "abc@mail.example" } });
    expect(at("/lisbon/mail?batch=3&filter=all")).toMatchObject({ route: "mail.list", search: { batch: 3, filter: "all" } });
    expect(at("/lisbon/log?kind=skipped&client=7")).toMatchObject({ route: "log.list", project: "lisbon", search: { kind: "skipped", client: 7 } });
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
    // P127 A2: the server renders a bare scoped address from `/_/…` (the rewrite in `src/proxy.ts`); both forms are one address.
    expect(at("/_/mail/c/id-42?filter=all")).toEqual(at("/mail/c/id-42?filter=all"));
    expect(at("/_/settings")).toEqual(at("/settings"));
    expect(at("/_")).toEqual(at("/"));
    expect(at("/help")).toMatchObject({ route: "help.page", section: "help", project: null });
  });

  it("knows the sections, and the empty address is the entry", () => {
    for (const s of SECTIONS) expect(at(`/${s.id === "log" ? "log" : s.id}`).section).toBe(s.id);
    expect(at("/")).toMatchObject({ route: "mail.list", entry: true });
  });

  it("an unknown path, the old /clients, a bad id, an extra segment or a project before a projectless section is Not found", () => {
    for (const p of ["/mail/c/42", "/mail/c/abc%40", "/messengers/settings", "/lisbon/messengers/settings", "/clients", "/nope", "/mail/abc", "/mail/0", "/mail/-1", "/mail/1.5", "/bulk", "/bulk/3", "/mail/1/2", "/log/3", "/settings/x", "/settings/mail/1", "/knowledge/x", "/help/x", "/main", "/lisbon", "/lisbon/overview", "/lisbon/help", "/lisbon/settings/connections", "/lisbon/settings/mac", "/_/overview", "/_/settings/connections", "/project", "/project/setup", "/agents", "/connections", "/lisbon/project", "/lisbon/agents", "/lisbon/mail/1/2", "/%E0%A4%A/mail", `/${OLD}`, `/${OLD}/42`, `/lisbon/${OLD}`, "/mail/in", "/mail/in/7", "/mail/in/abc", "/mail/in/1/2", "/mail/42", "/lisbon/mail/42", "/mail/c", "/mail/c/abc", "/mail/c/id-0", "/mail/c/id-1/2"]) {
      expect(at(p).route, p).toBe("notFound");
    }
    expect(REDIRECTS).toEqual([]);
  });

  it("a filter outside its enum resets to the default instead of breaking the view", () => {
    expect(at("/mail?filter=zzz")).toMatchObject({ search: { filter: "needs_you" } });
    expect(at("/mail?filter=all")).toMatchObject({ search: { filter: "all" } }); // All is a choice, so it keeps its key
    // P99: the views before (To review, Inbox, Hold, Thin basis, Sent, Finished) are words on a row now; no alias.
    for (const old of ["ready", "inbox", "hold", "thin_basis", "evidence", "sent", "finished"]) expect(at(`/mail?filter=${old}`), old).toMatchObject({ search: { filter: "needs_you" } });
    expect(at("/mail?filter=sequences")).toMatchObject({ search: { filter: "sequences" } });
    expect(at("/mail?filter=not_by_email")).toMatchObject({ search: { filter: "not_by_email" } });
    expect(at("/mail?filter=sequence")).toMatchObject({ search: { filter: "needs_you" } });
    expect(at("/mail?batch=abc")).toMatchObject({ search: { batch: null } });
    expect(at("/mail?batch=0")).toMatchObject({ search: { batch: null } });
    expect(at("/log?kind=failed&client=abc&run=3")).toEqual(expect.objectContaining({ search: { kind: "all", client: null } }));
    expect(at("/knowledge?filter=nope")).toMatchObject({ search: { filter: "all", q: "", topic: "" } });
    expect(at("/knowledge?filter=attention&q=x")).toMatchObject({ search: { filter: "attention", q: "x" } });
    expect(at("/knowledge?topic=API")).toMatchObject({ search: { topic: "api" } });
    expect(at("/knowledge?topic=all%20brands%2Fpricing")).toMatchObject({ search: { topic: "all brands/pricing" } });
    expect(at("/knowledge?topic=%2Fapi")).toMatchObject({ search: { topic: "" } });
  });
});

describe("paths and places", () => {
  const cases: [string, Dest, string, string][] = [
    ["drafts list", dest("mail.list"), "/mail", "/lisbon/mail"],
    ["waiting", dest("mail.list", { filter: "waiting" }), "/mail?filter=waiting", "/lisbon/mail?filter=waiting"],
    ["a conversation by email", dest("mail.conversation", { key: "ana@example.com" }), "/mail/c/ana%40example.com", "/lisbon/mail/c/ana%40example.com"],
    ["a conversation", dest("mail.conversation", { key: "id-42" }, { filter: "all" }), "/mail/c/id-42?filter=all", "/lisbon/mail/c/id-42?filter=all"],
    ["a conversation of a batch", dest("mail.conversation", { key: "id-42" }, { batch: 3 }), "/mail/c/id-42?batch=3", "/lisbon/mail/c/id-42?batch=3"],
    ["a conversation at one message", dest("mail.conversation", { key: "id-7" }, { m: "a@b" }), "/mail/c/id-7?m=a%40b", "/lisbon/mail/c/id-7?m=a%40b"],
    ["drafts search", dest("mail.list", { q: "ana" }), "/mail?q=ana", "/lisbon/mail?q=ana"],
    ["needs you is the default", dest("mail.list", { filter: "needs_you" }), "/mail", "/lisbon/mail"],
    ["log client", dest("log.list", { kind: "drafts", client: 5 }), "/log?kind=drafts&client=5", "/lisbon/log?kind=drafts&client=5"],
    ["knowledge", dest("knowledge.page"), "/knowledge", "/lisbon/knowledge"],
    ["knowledge: a view and a search", dest("knowledge.page", { filter: "expired", q: "price" }), "/knowledge?filter=expired&q=price", "/lisbon/knowledge?filter=expired&q=price"],
    ["knowledge: a topic", dest("knowledge.page", { topic: "api" }), "/knowledge?topic=api", "/lisbon/knowledge?topic=api"],
    ["settings: sending", dest("settings.page"), "/settings", "/lisbon/settings"],
    ["settings: mail", dest("settings.mail"), "/settings/mail", "/lisbon/settings/mail"],
    ["settings: checks", dest("settings.checks"), "/settings/checks", "/lisbon/settings/checks"],
    ["settings: agent", dest("settings.agent"), "/settings/agent", "/lisbon/settings/agent"],
    ["settings: agent, every tool row", dest("settings.agent", { filter: "all" }), "/settings/agent?filter=all", "/lisbon/settings/agent?filter=all"],
    ["settings: connections", dest("settings.connections"), "/settings/connections", "/settings/connections"],
    ["settings: this mac", dest("settings.mac"), "/settings/mac", "/settings/mac"],
    ["help", dest("help.page"), "/help", "/help"],
    ["overview", dest("overview.page"), "/overview", "/overview"],
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
    expect(roundTrip(dest("mail.list"), { project: "demo shop", multi: true }).project).toBe("demo shop");
  });

  it("every section has a list destination that resolves to that section; every instance has every section (P70: six parents; P71 M3: Messengers)", () => {
    for (const s of SECTIONS) expect(roundTrip(sectionList(s.id), MANY).section).toBe(s.id);
    expect(SECTIONS.map((s) => s.id)).toEqual(["overview", "mail", "messengers", "log", "knowledge", "settings", "help"]);
    expect(SECTIONS.map((s) => s.chord[1])).toEqual(["o", "e", "m", "a", "k", "s", "h"]);
    expect(SECTIONS.filter((s) => s.phone === "bar").map((s) => s.id)).toEqual(["overview", "mail", "log", "settings"]);
  });

  it("child pages (P70): Settings' Mail, Agent, Connections, This Mac in order; Messengers' Settings (P71 M3); no other section has one; `g s` lands on Sending", () => {
    expect(childrenOf("settings").map((c) => c.route)).toEqual(["settings.checks", "settings.mail", "settings.messengers", "settings.agent", "settings.connections", "settings.mac"]);
    expect(childrenOf("messengers")).toEqual([]);
    expect(roundTrip(dest("messengers.page", { filter: "waiting" }), MANY)).toMatchObject({ route: "messengers.page", search: { filter: "waiting", link: "any", channel: "all" } });
    expect(roundTrip(dest("messengers.conversation", { id: 7 }, { filter: "all", link: "linked", channel: "whatsapp" }), MANY)).toMatchObject({ route: "messengers.conversation", params: { id: 7 }, search: { filter: "all", link: "linked", channel: "whatsapp" } });
    // P84c: the channel is a filter of the same page; an unknown view or channel resets to its default, the default drops its key.
    expect(roundTrip(dest("messengers.page", { filter: "all", link: "hidden", channel: "whatsapp" }), MANY)).toMatchObject({ route: "messengers.page", search: { filter: "all", link: "hidden", channel: "whatsapp" } });
    expect(roundTrip(dest("messengers.page", { link: "unlinked", q: "Anna Field" }), MANY)).toMatchObject({ route: "messengers.page", search: { filter: "needs_you", link: "unlinked", channel: "all", q: "Anna Field" } });
    expect(dest("messengers.page", { filter: "needs_you", link: "any", channel: "all" }).search).toEqual({});
    for (const s of SECTIONS.filter((x) => x.id !== "settings" && x.id !== "messengers")) expect(childrenOf(s.id), s.id).toEqual([]);
    expect(sectionList("settings").route).toBe("settings.page");
  });

  it("every place a dot can name maps to a page that resolves (the map is total over the contract)", () => {
    expect(Object.keys(NEXT_ROUTE).sort()).toEqual([...STATUS_NEXT].sort());
    for (const place of STATUS_NEXT) expect(roundTrip(dest(NEXT_ROUTE[place]), MANY).route, place).toBe(NEXT_ROUTE[place]);
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
  it("the entry opens Mail with one project and Overview with several; Overview is a page on every instance (P63)", () => {
    expect(canon("/", ONE)).toBe("/mail");
    expect(canon("/", MANY)).toBe("/overview");
    expect(canon("/overview", ONE)).toBeNull();
    expect(canon("/overview", MANY)).toBeNull();
    expect(canon("/lisbon/settings/mail", ONE)).toBe("/settings/mail");
    expect(canon("/settings/agent", MANY)).toBe("/lisbon/settings/agent");
    expect(canon("/help", MANY)).toBeNull();
  });
  it("one project: no project in the address; several: the project in the path", () => {
    expect(canon("/mail", ONE)).toBeNull();
    expect(canon("/lisbon/mail/c/id-42", ONE)).toBe("/mail/c/id-42");
    expect(canon("/mail/c/id-42?filter=waiting", MANY)).toBe("/lisbon/mail/c/id-42?filter=waiting");
    expect(canon("/lisbon/mail/c/id-42?filter=waiting", MANY)).toBeNull();
    expect(canon("/settings/connections", MANY)).toBeNull();
  });
  it("P127 A2: an instance pane exists once, at the top; with a project before it, it is Not found and left alone (no fold page)", () => {
    expect(canon("/lisbon/settings/connections", MANY)).toBeNull();
    expect(canon("/lisbon/settings/mac", ONE)).toBeNull();
    expect(canon("/settings/mac", ONE)).toBeNull();
  });
  it("saved links of the query era (until 2026-11-18): `?project=` is read once and written back in the path form", () => {
    expect(canon("/mail/c/id-1?project=lisbon", MANY)).toBe("/lisbon/mail/c/id-1");
    expect(canonicalAddress(at("/mail/c/id-1?project=lisbon"), { project: "lisbon", multi: false }, "/mail/c/id-1?project=lisbon")).toBe("/mail/c/id-1");
    expect(at("/mail/c/id-1?project=lisbon").project).toBe("lisbon");
    expect(canon("/settings/connections?project=lisbon", MANY)).toBe("/settings/connections");
  });
  it("a dead filter and the deleted batch builder's `?new=1` (2026-11-18) are dropped; Not found and no project are left alone", () => {
    expect(canon("/mail?filter=zzz", ONE)).toBe("/mail");
    expect(canon("/mail?new=1", ONE)).toBe("/mail");
    expect(canon("/nope", ONE)).toBeNull();
    expect(canonicalAddress(at("/mail"), { project: null, multi: false }, "/mail")).toBeNull();
  });
  it("a rewritten address is stable (no redirect loop)", () => {
    const first = canon("/mail/c/id-3?filter=needs_you&project=x", { project: "x", multi: true });
    expect(first).toBe("/x/mail/c/id-3");
    expect(canon(first ?? "", { project: "x", multi: true })).toBeNull();
  });
});
