import { describe, expect, it } from "vitest";
import { focusInput, parseRef } from "@hub/contract/focus";
import { deriveFocus, sameFocus, type FocusParts } from "../src/features/focus/derive";
import { agentSeesLine } from "../src/lib/focus";
import { destOfRef, resolveRoute } from "../src/routes/resolve";
import { ROUTE_IDS, ROUTE_TABLE } from "../src/routes/table";

// The focus this tab publishes (P51 F5, P72): derived from the address, the screen's subject channel, the row he is on, the
// selection and the rows on screen; always a valid post, on every route of the table.

const NONE: FocusParts = { subject: null, pointed: null, selected: [], window: null, pointer: null };
const derive = (path: string, search = "", parts: Partial<FocusParts> = {}, project: string | null = "acme") =>
  deriveFocus({ tab: "t1", route: resolveRoute(path, search), project, parts: { ...NONE, ...parts }, visible: true });

/** An address of every route of the table, filled with an id where it has one. */
const sample = (id: (typeof ROUTE_IDS)[number]): string => {
  const p = ROUTE_TABLE[id].path.replace("[id]", "12");
  return ROUTE_TABLE[id].scoped ? `/acme${p}` : p;
};

describe("deriveFocus", () => {
  it("every route of the table derives a post the server accepts, with its own non-empty title and its route id", () => {
    for (const id of ROUTE_IDS) {
      const f = derive(sample(id));
      expect(f.route, id).toBe(id);
      expect(f.title.length, id).toBeGreaterThan(0);
      expect(focusInput.safeParse(f).success, `${id} ${JSON.stringify(f)}`).toBe(true);
    }
    expect(derive("/acme/nothing-here")).toMatchObject({ route: "notFound", title: "Not found" });
  });
  it("the titles are the route table's words: no 'Project', no 'other'", () => {
    expect(derive("/acme/knowledge").title).toBe("Knowledge");
    expect(derive("/help").title).toBe("Help");
    expect(derive("/acme/settings").title).toBe("Sending");
    expect(derive("/acme/settings/mail").title).toBe("Mail");
    expect(derive("/acme/settings/agent").title).toBe("Agent");
    expect(derive("/acme/mail/12").title).toBe("Draft 12");
    // P96: the dock says the Mail view too ("Agent sees: Mail · Inbox"), and a client's message by its crumb.
    expect(derive("/acme/mail", "filter=inbox").title).toBe("Mail · Inbox");
    expect(derive("/acme/mail").title).toBe("Mail · To review");
    expect(derive("/acme/mail/in/5").title).toBe("Message 5");
    for (const id of ROUTE_IDS) expect(derive(sample(id)).title, id).not.toMatch(/^(Project|other|another page)$/);
  });
  it("a draft's address names the draft and the view; the open card wins over the address (P53)", () => {
    expect(derive("/acme/mail/12", "filter=hold")).toEqual({ tab: "t1", project: "acme", route: "mail.item", title: "Draft 12", subject: "draft:12", selected: [], view: { filter: "hold" }, visible: true });
    expect(derive("/acme/mail/99", "", { subject: "draft:7" })).toMatchObject({ subject: "draft:7" });
  });
  it("the Mail list: the card on screen, the selection and the search", () => {
    const f = derive("/acme/mail", "q=price", { subject: "draft:7", selected: ["draft:7", "draft:9"] });
    expect(f).toMatchObject({ route: "mail.list", subject: "draft:7", selected: ["draft:7", "draft:9"], view: { q: "price" } });
  });
  it("Activity narrowed to one client names that client as the subject (/log?client=1, P73), not a view", () => {
    expect(derive("/acme/log", "client=1")).toMatchObject({ route: "log.list", title: "Activity", subject: "client:1" });
    expect(derive("/acme/log", "client=1").view).toBeUndefined();
    expect(derive("/acme/log", "filter=skipped&client=1").view).toEqual({ filter: "skipped" });
  });
  it("Knowledge: the row he is on and the rows on screen, refs only", () => {
    const f = derive("/acme/knowledge", "q=csv", { pointed: "knowledge:knowledge/files/a.md", window: { refs: ["knowledge:knowledge/files/a.md", "knowledge:knowledge/files/b.md"], total: 57 } });
    expect(f).toMatchObject({ route: "knowledge.page", title: "Knowledge", pointed: "knowledge:knowledge/files/a.md", window: { total: 57 }, view: { q: "csv" } });
    expect(f.subject).toBeUndefined();
  });
  it("the projectless routes name no project; the pointer's outcome rides along", () => {
    for (const p of ["/overview", "/help", "/settings/connections", "/settings/mac"]) expect(derive(p).project, p).toBeNull();
    expect(derive("/acme/knowledge", "", { pointer: { id: "abcdef0123456789", outcome: "shown" } }).pointer).toEqual({ id: "abcdef0123456789", outcome: "shown" });
  });
  it("caps the selection at 200 and the window at 30", () => {
    const many = Array.from({ length: 250 }, (_, i) => `draft:${i + 1}`);
    const f = derive("/acme/mail", "", { selected: many, window: { refs: many, total: 250 } });
    expect(f.selected).toHaveLength(200);
    expect(f.window?.refs).toHaveLength(30);
    expect(focusInput.safeParse(f).success).toBe(true);
  });
  it("sameFocus compares the whole focus", () => {
    expect(sameFocus(derive("/acme/mail/3"), derive("/acme/mail/3"))).toBe(true);
    expect(sameFocus(derive("/acme/mail/3"), derive("/acme/mail/4"))).toBe(false);
    expect(sameFocus(null, derive("/acme/mail/4"))).toBe(false);
  });
});

describe("refs", () => {
  it("parse by kind and refuse a malformed id or an unknown kind", () => {
    expect(parseRef("draft:42")).toEqual({ kind: "draft", id: "42" });
    expect(parseRef("knowledge:knowledge/files/a.md")).toEqual({ kind: "knowledge", id: "knowledge/files/a.md" });
    for (const bad of ["draft:0", "draft:x", "knowledge:../etc", "screen:knowledge", "draft", ":1"]) expect(parseRef(bad), bad).toBeNull();
  });
  it("lead somewhere for Show: a client to its timeline in Activity, a run to Activity (P73)", () => {
    expect(destOfRef("draft:4")?.route).toBe("mail.item");
    expect(destOfRef("run:10")).toMatchObject({ route: "log.list", search: {} });
    expect(destOfRef("knowledge:knowledge/a.md", "CSV export")).toMatchObject({ route: "knowledge.page", search: { q: "CSV export" } });
    expect(destOfRef("client:3")).toMatchObject({ route: "log.list", search: { client: "3" } });
  });
});

describe("the dock header line", () => {
  it("says the screen's title and what the agent takes for 'this', by the words on the row", () => {
    const labels = { subject: null, pointed: null };
    expect(agentSeesLine(null, labels)).toBe("Agent sees: nothing current");
    expect(agentSeesLine(derive("/acme/mail/12"), { subject: { ref: "draft:12", label: "Fiona Focus" }, pointed: null })).toBe("Agent sees: Draft 12 · Fiona Focus");
    expect(agentSeesLine(derive("/acme/mail", "", { selected: ["draft:1", "draft:2", "draft:3"] }), labels)).toBe("Agent sees: Mail · To review · 3 selected");
    const k = derive("/acme/knowledge", "", { pointed: "knowledge:knowledge/a.md" });
    expect(agentSeesLine(k, { subject: null, pointed: { ref: "knowledge:knowledge/a.md", label: "Can I download everything as CSV?" } })).toBe("Agent sees: Knowledge · Can I download everything as CSV?");
    expect(agentSeesLine(derive("/acme/settings/mail"), labels)).toBe("Agent sees: Mail");
  });
});
