import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SECTION_NAV_MIN_PX, SectionLayout } from "../src/product/shell/section-layout";
import { navGroups, SectionNav, type SectionNavItem } from "../src/product/shell/section-nav";

// P125 L1: the section menu's grouping, nesting and counts, and that the selection is marked for a screen reader.
const item = (id: string, o: Partial<SectionNavItem> = {}): SectionNavItem => ({ id, label: id, current: false, render: (content, className) => <a className={className} href={`#${id}`}>{content}</a>, ...o });

describe("navGroups", () => {
  it("keeps the order, starts a run at each new group, and lets an ungrouped item join the run before it", () => {
    const g = navGroups([item("all"), item("api", { group: "Acme" }), item("auth", { depth: 1 }), item("billing", { group: "Beta" })]);
    expect(g.map((x) => [x.group, x.items.map((i) => i.id)])).toEqual([[null, ["all"]], ["Acme", ["api", "auth"]], ["Beta", ["billing"]]]);
    expect(navGroups([])).toEqual([]);
  });
});

describe("SectionNav", () => {
  it("is one named nav with a heading per group, the counts, one indent level, and the current item marked by the caller's link", () => {
    const html = renderToStaticMarkup(
      <SectionNav items={[item("all", { count: 57 }), item("api", { group: "Acme", count: 10, current: true, render: (c, cls) => <a aria-current="page" className={cls} href="#api">{c}</a> }), item("auth", { depth: 1, count: 0 })]} label="Topics" />,
    );
    expect(html).toContain('aria-label="Topics"');
    expect(html).toContain('data-slot="section-nav"');
    expect(html).toContain(">Acme</h3>");
    expect(html).toContain(">57<");
    expect(html).toContain(">0<");
    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(/ps-6[^>]*href="#auth"|href="#auth"[^>]*ps-6/);
  });

  it("owner 2026-11-25: the tabs form is the same links in one row that scrolls in its own strip, no group heading, no drawer", () => {
    const html = renderToStaticMarkup(<SectionNav form="tabs" items={[item("sending", { group: "Settings", current: true, render: (c, cls) => <a aria-current="page" className={cls} href="#sending">{c}</a> }), item("checks", { count: 2 })]} label="Settings pages" />);
    expect(html).toContain('aria-label="Settings pages"');
    expect(html).toContain('data-form="tabs"');
    expect(html).toContain("scroll-strip");
    expect(html).toContain('data-slot="segmented-control"');
    expect(html).not.toContain("<h3");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(">2<");
  });
});

describe("SectionLayout", () => {
  it("draws the column and the tabs, one shown by the layout's own width (640px), and no sheet button", () => {
    const html = renderToStaticMarkup(<SectionLayout nav={(form) => <SectionNav form={form} items={[item("a")]} label="Pages" />} navLabel="Pages"><p>body</p></SectionLayout>);
    expect(SECTION_NAV_MIN_PX).toBe(640);
    expect(html).toMatch(/<aside[^>]*@\[40rem\]:block/);
    expect(html).toContain('data-slot="section-tabs"');
    expect(html).toContain('data-form="tabs"');
    expect(html).not.toContain("<button");
  });
});
