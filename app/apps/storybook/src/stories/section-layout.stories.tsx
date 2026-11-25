import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SectionLayout } from "@hub/ui/product/shell/section-layout";
import { SectionNav, type SectionNavItem } from "@hub/ui/product/shell/section-nav";

const VIEWS = [
  { id: "all", label: "All", count: 42 },
  { id: "pricing", label: "Pricing", count: 7, group: "Topics" },
  { id: "pricing-2026", label: "2026 list", count: 3, depth: 1 as const },
  { id: "delivery", label: "Delivery", count: 12 },
  { id: "returns", label: "Returns", count: null },
];

/** One section layout (P125 L1) with its menu column; from 640px of its own width a column (compact below 960px); narrower, a row of tabs on top. */
function Section({ width }: { width: number }) {
  const [current, setCurrent] = useState("all");
  const items: SectionNavItem[] = VIEWS.map((v) => ({
    ...v,
    current: v.id === current,
    render: (content: ReactNode, className: string) => (
      <a aria-current={v.id === current ? "page" : undefined} className={className} href={`#${v.id}`} onClick={(e) => { e.preventDefault(); setCurrent(v.id); }}>
        {content}
      </a>
    ),
  }));
  return (
    <div className="h-[420px] border bg-background" style={{ width }}>
      <SectionLayout nav={(form) => <SectionNav form={form} items={items} label="Knowledge views" />} navLabel="Knowledge views">
        <p className="p-4">The entries of “{VIEWS.find((v) => v.id === current)?.label}”.</p>
      </SectionLayout>
    </div>
  );
}

const meta = { title: "Product/Section layout", component: Section, args: { width: 1100 } } satisfies Meta<typeof Section>;
export default meta;
export const Wide: StoryObj<typeof meta> = {};
export const Narrow: StoryObj<typeof meta> = { args: { width: 600 } };
