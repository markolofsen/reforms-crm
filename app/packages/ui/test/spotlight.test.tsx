import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { announcement, hasBox, isTyping, refSelector, SPOTLIGHT_WAIT_MS } from "../src/product/spotlight/model";
import { Spotlight } from "../src/product/spotlight/spotlight";

// The agent's pointer (P72): the pure half in node; the drawing itself is checked in the admin's e2e (`z-pointer.spec.ts`).
describe("spotlight", () => {
  it("finds a ref by an escaped attribute selector, never by a kept node", () => {
    expect(refSelector("data-agent-ref", "knowledge:knowledge/a.md")).toBe('[data-agent-ref="knowledge:knowledge/a.md"]');
    expect(refSelector("data-agent-ref", 'x"y\\z')).toBe('[data-agent-ref="x\\"y\\\\z"]');
  });
  it("a row hidden by display none (the other width's twin) has no box", () => {
    expect(hasBox({ width: 0, height: 0 })).toBe(false);
    expect(hasBox({ width: 10, height: 20 })).toBe(true);
  });
  it("never scrolls while he types: a field, a select, an editable region, the terminal's textarea", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(isTyping({ tagName })).toBe(true);
    expect(isTyping({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTyping({ tagName: "TR" })).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
  it("waits 800 ms and announces the rows and the note as words", () => {
    expect(SPOTLIGHT_WAIT_MS).toBe(800);
    expect(announcement(1, "this one")).toBe("Agent points at a row: this one");
    expect(announcement(3, null)).toBe("Agent points at 3 rows");
  });
  it("the server render draws nothing (the first render reads no DOM)", () => {
    expect(renderToStaticMarkup(<Spotlight note="x" onOutcome={() => undefined} refs={["draft:1"]} ttlMs={30_000} />)).toBe("");
  });
});
