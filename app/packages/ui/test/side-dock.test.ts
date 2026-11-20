import { describe, expect, it } from "vitest";
import { DOCK_WIDTH, clampWidth, dragWidth, keyWidth, maxWidth, parseWidth } from "../src/product/side-dock/size";
import { ENTER_SETTLE_MS, enterPacer, isToggleChord, keyRoute, SHIFT_ENTER } from "../src/product/terminal/keys";
import { TERMINAL_TOKENS } from "../src/product/terminal/theme";

// The side dock's width rules and the terminal's key routing, as pure functions (P49 T2).
describe("side dock width", () => {
  it("clamps between 400px and 60 % of the viewport, in whole pixels", () => {
    expect(clampWidth(300, 1280)).toBe(400);
    expect(clampWidth(560.4, 1280)).toBe(560);
    expect(clampWidth(2000, 1280)).toBe(768);
    // A viewport so narrow that 60 % is under the minimum keeps the minimum.
    expect(clampWidth(900, 600)).toBe(400);
  });
  it("sets no upper bound before the viewport is known (the server's snapshot is 0)", () => {
    expect(maxWidth(0)).toBe(Number.POSITIVE_INFINITY);
    expect(clampWidth(1500, 0)).toBe(1500);
  });
  it("re-clamps the drawn width to a smaller viewport without changing the saved one", () => {
    const saved = 900;
    expect(clampWidth(saved, 1920)).toBe(900);
    expect(clampWidth(saved, 1280)).toBe(768);
    expect(saved).toBe(900);
  });
  it("reads a saved text back, and anything unreadable is the default", () => {
    expect(parseWidth("640")).toBe(640);
    expect(parseWidth(null)).toBe(DOCK_WIDTH.default);
    expect(parseWidth("wide")).toBe(DOCK_WIDTH.default);
    expect(parseWidth("-5")).toBe(DOCK_WIDTH.default);
  });
  it("ArrowLeft widens and ArrowRight narrows by 24px, Home resets, other keys are not the separator's", () => {
    expect(keyWidth("ArrowLeft", 560, 1280)).toBe(584);
    expect(keyWidth("ArrowRight", 560, 1280)).toBe(536);
    expect(keyWidth("ArrowRight", 410, 1280)).toBe(400);
    expect(keyWidth("ArrowLeft", 760, 1280)).toBe(768);
    expect(keyWidth("Home", 700, 1280)).toBe(DOCK_WIDTH.default);
    expect(keyWidth("Enter", 560, 1280)).toBeNull();
  });
  it("a drag to the left widens the dock (its separator is on its start edge), clamped", () => {
    expect(dragWidth(560, 700, 650, 1280)).toBe(610);
    expect(dragWidth(560, 700, 900, 1280)).toBe(400);
    expect(dragWidth(560, 700, 0, 1280)).toBe(768);
  });
});

const key = (over: Partial<Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">>) => ({ key: "a", code: "KeyA", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

describe("terminal keys", () => {
  it("leaves Ctrl+` (alone) to the page, so the toggle works while the terminal has focus", () => {
    expect(keyRoute(key({ key: "`", code: "Backquote", ctrlKey: true }))).toBe("app");
    expect(isToggleChord(key({ key: "`", code: "Backquote", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isToggleChord(key({ key: "`", code: "Backquote", metaKey: true }))).toBe(false);
  });
  it("sends a new line for Shift+Enter, ESC CR", () => {
    expect(keyRoute(key({ key: "Enter", code: "Enter", shiftKey: true }))).toBe("newline");
    expect(SHIFT_ENTER).toBe("\x1b\r");
    expect(keyRoute(key({ key: "Enter", code: "Enter" }))).toBe("program");
  });
  it("gives every other key to the program: Escape, ?, [ and a plain backquote", () => {
    for (const k of [key({ key: "Escape", code: "Escape" }), key({ key: "?", code: "Slash", shiftKey: true }), key({ key: "[", code: "BracketLeft" }), key({ key: "`", code: "Backquote" })]) expect(keyRoute(k)).toBe("program");
  });
});

describe("terminal Enter after a chunk (P88)", () => {
  const rig = () => {
    let t = 0;
    const sent: string[] = [];
    const timers: { at: number; fn: () => void }[] = [];
    const input = enterPacer((d) => sent.push(d), () => t, (fn, ms) => void timers.push({ at: t + ms, fn }));
    const tick = (ms: number) => {
      t += ms;
      for (const x of timers.splice(0).filter((x) => x.at <= t)) x.fn();
    };
    return { input, sent, tick };
  };
  it("holds an Enter that follows a chunk of text until the chunk is settled, and keeps the order", () => {
    const r = rig();
    r.input("write to the clients");
    r.tick(10);
    r.input("\r");
    r.input("x");
    expect(r.sent).toEqual(["write to the clients"]);
    r.tick(ENTER_SETTLE_MS);
    expect(r.sent).toEqual(["write to the clients", "\r", "x"]);
  });
  it("never holds typed keys or an Enter after them, nor one after an escape sequence", () => {
    const r = rig();
    for (const k of ["h", "i", "\r"]) r.input(k);
    r.input("\x1b[A");
    r.input("\r");
    expect(r.sent).toEqual(["h", "i", "\r", "\x1b[A", "\r"]);
  });
  it("sends an Enter at once when the chunk is older than the settle time", () => {
    const r = rig();
    r.input("a phrase");
    r.tick(ENTER_SETTLE_MS + 1);
    r.input("\r");
    expect(r.sent).toEqual(["a phrase", "\r"]);
  });
});

describe("terminal theme tokens", () => {
  it("maps the ground, the text, the cursor, the selection and all 16 ANSI colours to a token", () => {
    expect(Object.keys(TERMINAL_TOKENS)).toEqual(expect.arrayContaining(["background", "foreground", "cursor", "selectionBackground", "black", "brightWhite", "brightMagenta"]));
    expect(Object.keys(TERMINAL_TOKENS).filter((k) => !["background", "foreground", "cursor", "cursorAccent", "selectionBackground"].includes(k))).toHaveLength(16);
  });
});
