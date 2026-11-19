import { afterEach, describe, expect, it, vi } from "vitest";
import { CHORD_WINDOW_MS, createDispatcher, isTypingTarget, TYPING, type KeyEventLike, type Timers } from "../src/hooks/use-hotkeys";
import { SECTIONS } from "../src/routes/sections";
import { crumbsOf, pageTitle, titleOf } from "../src/routes/meta";
import { resolveRoute } from "../src/routes/resolve";

const key = (k: string, over: Partial<KeyEventLike> = {}): KeyEventLike => ({ key: k, typing: false, modifier: false, preventDefault: () => {}, ...over });

// Fake timers that the test advances by hand.
function clock() {
  const pending = new Map<number, () => void>();
  let n = 0;
  const timers: Timers = { set: (fn) => (pending.set(++n, fn), n), clear: (id) => void pending.delete(id) };
  return { timers, expire: () => [...pending.values()].forEach((fn) => fn()), open: () => pending.size };
}

function setup(enabled = () => true) {
  const calls: string[] = [];
  const c = clock();
  const chords = Object.fromEntries(SECTIONS.map((s) => [`${s.chord[0]} ${s.chord[1]}`, () => calls.push(s.id)]));
  const dispatch = createDispatcher(() => ({ ...chords, j: () => calls.push("j") }), enabled, c.timers);
  return { calls, dispatch, c };
}

afterEach(() => vi.useRealTimers());

describe("hotkeys dispatcher", () => {
  it("a chord fires once, then resets", () => {
    const { calls, dispatch } = setup();
    dispatch(key("g"));
    dispatch(key("d"));
    dispatch(key("d"));
    expect(calls).toEqual(["drafts"]);
  });
  it("derives one chord per section from SECTIONS", () => {
    const { calls, dispatch } = setup();
    for (const s of SECTIONS) {
      dispatch(key(s.chord[0]));
      dispatch(key(s.chord[1]));
    }
    expect(calls).toEqual(SECTIONS.map((s) => s.id));
  });
  it("another key after the first resets the chord and is handled as a single key", () => {
    const { calls, dispatch } = setup();
    dispatch(key("g"));
    dispatch(key("j"));
    dispatch(key("d"));
    expect(calls).toEqual(["j"]);
  });
  it("the first key times out after the window", () => {
    const { calls, dispatch, c } = setup();
    dispatch(key("g"));
    expect(c.open()).toBe(1);
    c.expire(); // CHORD_WINDOW_MS later
    dispatch(key("d"));
    expect(calls).toEqual([]);
    expect(CHORD_WINDOW_MS).toBe(800);
  });
  it("is silent while a person types, with a modifier held, or when the switch is off", () => {
    const { calls, dispatch } = setup();
    dispatch(key("g", { typing: true }));
    dispatch(key("d", { typing: true }));
    dispatch(key("j", { modifier: true }));
    dispatch(key("g"));
    dispatch(key("d", { modifier: true }));
    dispatch(key("d"));
    expect(calls).toEqual([]);
    const off = setup(() => false);
    off.dispatch(key("j"));
    off.dispatch(key("g"));
    off.dispatch(key("d"));
    expect(off.calls).toEqual([]);
  });
  it("a modifier chord (the terminal's Ctrl+`) fires while a field or the terminal has focus, and only with Control alone", () => {
    const calls: string[] = [];
    let prevented = 0;
    const dispatch = createDispatcher(() => ({ "ctrl+`": () => calls.push("terminal"), "`": () => calls.push("plain") }), () => true);
    const prevent = { preventDefault: () => void prevented++ };
    dispatch(key("`", { modifier: true, ctrl: true, typing: true, ...prevent }));
    dispatch(key("`", { modifier: true, ctrl: false }));
    dispatch(key("j", { modifier: true, ctrl: true }));
    expect(calls).toEqual(["terminal"]);
    expect(prevented).toBe(1);
    const off = createDispatcher(() => ({ "ctrl+`": () => calls.push("off") }), () => false);
    off(key("`", { modifier: true, ctrl: true }));
    expect(calls).toEqual(["terminal"]);
  });
  it("keys are case-insensitive", () => {
    const { calls, dispatch } = setup();
    dispatch(key("G"));
    dispatch(key("P"));
    expect(calls).toEqual(["project"]);
  });
});

describe("document title", () => {
  it("names the item, the section, the project and the app; Not found names no section", () => {
    expect(titleOf(resolveRoute("/drafts", ""), "lisbon")).toBe("Drafts · lisbon · Hub Workflow");
    expect(titleOf(resolveRoute("/drafts/42", ""), "lisbon")).toBe("Draft 42 · Drafts · lisbon · Hub Workflow");
    expect(titleOf(resolveRoute("/log", ""), "x")).toBe("Activity · x · Hub Workflow");
    expect(titleOf(resolveRoute("/clients", ""), "x")).toBe("Not found · Hub Workflow");
    expect(crumbsOf(resolveRoute("/drafts/42", ""))).toEqual(["Drafts", "Draft 42"]);
  });
  it("a page file gives the same title as the address it serves (generateMetadata reads pageTitle)", () => {
    expect(pageTitle("drafts.list", "lisbon")).toBe(titleOf(resolveRoute("/drafts", ""), "lisbon"));
    expect(pageTitle("drafts.item", "lisbon", 42)).toBe(titleOf(resolveRoute("/drafts/42", ""), "lisbon"));
    expect(pageTitle("overview.page", "lisbon")).toBe("Overview · Hub Workflow");
    expect(titleOf(resolveRoute("/overview", ""), "lisbon")).toBe("Overview · Hub Workflow");
  });
});

describe("a capital letter", () => {
  it("fires its own key and not the lower-case one", () => {
    const calls: string[] = [];
    const press = createDispatcher(() => ({ a: () => calls.push("a"), A: () => calls.push("A") }), () => true);
    press({ key: "A", typing: false, modifier: false, preventDefault: () => {} });
    press({ key: "a", typing: false, modifier: false, preventDefault: () => {} });
    expect(calls).toEqual(["A", "a"]);
  });
  it("falls back to the lower-case key when the capital is not bound (caps lock)", () => {
    const calls: string[] = [];
    const press = createDispatcher(() => ({ a: () => calls.push("a") }), () => true);
    press({ key: "A", typing: false, modifier: false, preventDefault: () => {} });
    expect(calls).toEqual(["a"]);
  });
});

describe("the Overview chord", () => {
  it("g o is declared by the section list", () => {
    expect(SECTIONS.find((s) => s.id === "overview")?.chord).toEqual(["g", "o"]);
    // P70: Knowledge (g k) and Settings (g s) are scoped, Help (g h) is the instance's; a pane is titled by itself, under Settings.
    expect(SECTIONS.find((s) => s.id === "knowledge")?.chord).toEqual(["g", "k"]);
    expect(SECTIONS.find((s) => s.id === "settings")?.chord).toEqual(["g", "s"]);
    expect(SECTIONS.find((s) => s.id === "help")?.chord).toEqual(["g", "h"]);
    expect(titleOf(resolveRoute("/settings/connections", ""), "lisbon")).toBe("Connections · Hub Workflow");
    expect(titleOf(resolveRoute("/settings", ""), "lisbon")).toBe("Sending · lisbon · Hub Workflow");
    expect(titleOf(resolveRoute("/help", ""), "lisbon")).toBe("Help · Hub Workflow");
    expect(titleOf(resolveRoute("/lisbon/settings/agent", ""), "lisbon")).toBe(pageTitle("settings.agent", "lisbon"));
    expect(pageTitle("knowledge.page", "lisbon")).toBe("Knowledge · lisbon · Hub Workflow");
    expect(crumbsOf(resolveRoute("/settings/mail", ""))).toEqual(["Settings", "Mail"]);
  });
});

describe("typing guard", () => {
  // No DOM here: a fake Element whose `closest` answers for the roles and tags it carries, up its own chain.
  class FakeElement {
    constructor(private readonly tag: string, private readonly role: string | null = null, private readonly parent: FakeElement | null = null) {}
    closest(selector: string): FakeElement | null {
      const wants = selector.split(",");
      const mine = wants.includes(this.tag) || (this.role !== null && wants.includes(`[role=${this.role}]`));
      return mine ? this : (this.parent?.closest(selector) ?? null);
    }
  }
  const as = (e: FakeElement) => e as unknown as EventTarget;
  afterEach(() => vi.unstubAllGlobals());
  it("covers fields and every open menu, list or dialog, so first-letter typeahead never fires a page key", () => {
    vi.stubGlobal("Element", FakeElement);
    const menu = new FakeElement("div", "menu");
    expect(isTypingTarget(as(new FakeElement("div", "menuitem", menu)))).toBe(true);
    expect(isTypingTarget(as(new FakeElement("button", null, menu)))).toBe(true);
    expect(isTypingTarget(as(new FakeElement("button", null, new FakeElement("div", "dialog"))))).toBe(true);
    expect(isTypingTarget(as(new FakeElement("input")))).toBe(true);
    expect(isTypingTarget(as(new FakeElement("button")))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(TYPING.split(",")).toEqual(expect.arrayContaining(["[role=menu]", "[role=menuitem]", "[role=dialog]", "[role=listbox]"]));
  });
});
