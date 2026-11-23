import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
});
