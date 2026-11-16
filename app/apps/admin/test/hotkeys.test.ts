import { afterEach, describe, expect, it, vi } from "vitest";
import { CHORD_WINDOW_MS, createDispatcher, type KeyEventLike, type Timers } from "../src/hooks/use-hotkeys";
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
  it("keys are case-insensitive", () => {
    const { calls, dispatch } = setup();
    dispatch(key("G"));
    dispatch(key("B"));
    expect(calls).toEqual(["bulk"]);
  });
});

describe("document title", () => {
  it("names the item, the section, the project and the app; Not found names no section", () => {
    expect(titleOf(resolveRoute("/drafts", ""), "lisbon")).toBe("Drafts · lisbon · Hub Workflow");
    expect(titleOf(resolveRoute("/drafts/42", ""), "lisbon")).toBe("Draft 42 · Drafts · lisbon · Hub Workflow");
    expect(titleOf(resolveRoute("/bulk/3", ""), null)).toBe("Batch 3 · Bulk · Hub Workflow");
    expect(titleOf(resolveRoute("/log", ""), "x")).toBe("Activity · x · Hub Workflow");
    expect(titleOf(resolveRoute("/clients", ""), "x")).toBe("Not found · Hub Workflow");
    expect(crumbsOf(resolveRoute("/drafts/42", ""))).toEqual(["Drafts", "Draft 42"]);
  });
  it("a page file gives the same title as the address it serves (generateMetadata reads pageTitle)", () => {
    expect(pageTitle("drafts.list", "lisbon")).toBe(titleOf(resolveRoute("/drafts", ""), "lisbon"));
    expect(pageTitle("drafts.item", "lisbon", 42)).toBe(titleOf(resolveRoute("/drafts/42", ""), "lisbon"));
    expect(pageTitle("bulk.item", null, 3)).toBe(titleOf(resolveRoute("/bulk/3", ""), null));
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
  });
});
