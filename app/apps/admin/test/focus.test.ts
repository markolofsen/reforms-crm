import { describe, expect, it } from "vitest";
import { focusInput } from "@hub/contract/focus";
import { deriveFocus, sameFocus } from "../src/features/focus/derive";
import { agentSeesLine } from "../src/features/terminal/agent-sees";
import { resolveRoute } from "../src/routes/resolve";

// The focus this tab publishes (P51 F5): derived from the address, the card on screen and the selection; always a valid post.

const at = (path: string, search = "") => resolveRoute(path, search);
const derive = (path: string, search = "", o: { openDraftId?: number | null; selected?: number[]; project?: string | null } = {}) =>
  deriveFocus({ tab: "t1", route: at(path, search), project: o.project === undefined ? "acme" : o.project, openDraftId: o.openDraftId ?? null, selected: o.selected ?? [], visible: true });

describe("deriveFocus", () => {
  it("a draft's address names the draft and the view", () => {
    expect(derive("/acme/drafts/12", "filter=hold")).toEqual({ tab: "t1", project: "acme", visible: true, screen: "draft", draftId: 12, selected: [], view: "hold" });
  });
  it("the Drafts list names the card on screen (the desktop opens the first row) and the selection", () => {
    const f = derive("/acme/drafts", "q=price", { openDraftId: 7, selected: [7, 9] });
    expect(f).toMatchObject({ screen: "drafts", draftId: 7, selected: [7, 9], view: "ready", q: "price" });
    expect(derive("/acme/drafts", "filter=sequences").screen).toBe("follow-ups");
  });
  it("Activity, a run, Project; Overview and Connections name no project", () => {
    expect(derive("/acme/log").screen).toBe("activity");
    expect(derive("/acme/log", "run=4")).toMatchObject({ screen: "run", runId: 4 });
    expect(derive("/acme/project").screen).toBe("project");
    expect(derive("/overview")).toMatchObject({ screen: "overview", project: null });
    expect(derive("/connections")).toMatchObject({ screen: "connections", project: null });
    expect(derive("/acme/nothing-here").screen).toBe("other");
  });
  it("every derived focus is a post the server accepts, the selection capped at 200", () => {
    const many = Array.from({ length: 250 }, (_, i) => i + 1);
    for (const f of [derive("/acme/drafts", "", { selected: many }), derive("/acme/drafts/3"), derive("/overview"), derive("/acme/log", "run=2")]) {
      expect(focusInput.safeParse(f).success, JSON.stringify(f).slice(0, 80)).toBe(true);
    }
    expect(derive("/acme/drafts", "", { selected: many }).selected).toHaveLength(200);
  });
  it("sameFocus compares the whole focus", () => {
    expect(sameFocus(derive("/acme/drafts/3"), derive("/acme/drafts/3"))).toBe(true);
    expect(sameFocus(derive("/acme/drafts/3"), derive("/acme/drafts/4"))).toBe(false);
    expect(sameFocus(null, derive("/acme/drafts/4"))).toBe(false);
  });
});

describe("the dock header line", () => {
  it("says what the agent will take for 'this draft'", () => {
    expect(agentSeesLine(null)).toBe("Agent sees: nothing current");
    expect(agentSeesLine(derive("/acme/drafts/12"))).toBe("Agent sees: draft 12");
    expect(agentSeesLine(derive("/acme/drafts", "", { selected: [1, 2, 3] }))).toBe("Agent sees: the Drafts list · 3 selected");
  });
});
