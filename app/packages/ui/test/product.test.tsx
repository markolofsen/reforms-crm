import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionButton } from "../src/product/action-button";
import { FilterChips } from "../src/product/filter-chips";

// The render test P29 W0 asked for and P44 S1 found missing: the two product primitives every screen is built from.
describe("ActionButton", () => {
  it("is a secondary button of the middle size unless told otherwise, and marks its variant so a test can count the primaries", () => {
    const html = renderToStaticMarkup(<ActionButton>Skip</ActionButton>);
    expect(html).toContain("Skip");
    expect(html).toContain('data-variant="secondary"');
    expect(html).toContain("h-(--control-m)");
  });

  it("carries one of the four variants and one of the three sizes", () => {
    for (const variant of ["primary", "secondary", "quiet", "danger"] as const) expect(renderToStaticMarkup(<ActionButton variant={variant}>x</ActionButton>)).toContain(`data-variant="${variant}"`);
    for (const [size, token] of [["s", "h-(--control-s)"], ["m", "h-(--control-m)"], ["l", "h-(--control-l)"]] as const) expect(renderToStaticMarkup(<ActionButton size={size}>x</ActionButton>)).toContain(token);
  });

  it("an icon button is square and keeps the name it is given", () => {
    const html = renderToStaticMarkup(<ActionButton aria-label="More actions" icon>+</ActionButton>);
    expect(html).toContain('aria-label="More actions"');
    expect(html).toContain("size-(--control-m)");
  });
});

describe("FilterChips", () => {
  const chips = [
    { value: "ready", label: "To review", count: 6 },
    { value: "hold", label: "Hold", count: 0 },
    { value: "all", label: "All", count: undefined },
    { value: "plain", label: "Plain", count: null },
  ];

  it("renders one labelled group with every chip, its count, and the current one selected", () => {
    const html = renderToStaticMarkup(<FilterChips chips={chips} label="Show drafts" onChange={() => {}} value="ready" />);
    expect(html).toContain('aria-label="Show drafts"');
    for (const c of chips) expect(html).toContain(c.label);
    expect(html).toMatch(/aria-checked="true"[^>]*>To review/);
    expect(html).toMatch(/aria-checked="false"[^>]*>Hold/);
  });

  it("shows the count, a dash for an unknown one, and nothing for a plain choice", () => {
    const html = renderToStaticMarkup(<FilterChips chips={chips} label="x" onChange={() => {}} value="ready" />);
    expect(html).toContain(">6</span>");
    expect(html).toContain(">0</span>");
    expect(html).toContain(">-</span>");
    expect(html).not.toMatch(/Plain<span/);
  });
});
