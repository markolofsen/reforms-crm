import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionButton } from "@hub/ui/product/action-button";
import { ListDetail, ListScrollArea } from "@hub/ui/product/list/detail";
import { Page } from "@hub/ui/product/shell/page";

function SampleContent({ rows = 12 }: { rows?: number }) {
  return (
    <div className="flex min-h-0 flex-col gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <div className="flex min-h-11 items-center rounded-md border px-3 text-sm" key={index}>
          Contact {index + 1}
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: "Product/Page",
  component: Page,
  args: { children: <SampleContent /> },
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Scrollable: Story = {
  args: {
    nav: <span className="font-medium">Single-column screen</span>,
    children: <SampleContent />,
  },
};

export const FixedSplitShell: Story = {
  render: () => (
    <Page flush nav={<span className="font-medium">Fixed split shell</span>} scroll={false}>
      <ListDetail
        detail={<div className="min-h-0 flex-1 overflow-y-auto p-4"><h2 className="mb-3 font-medium text-sm">Detail</h2><SampleContent rows={24} /></div>}
        detailLabel="Detail"
        list={<ListScrollArea className="p-4"><div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-medium text-sm">List</h2><ActionButton size="s" variant="secondary">Filter</ActionButton></div><SampleContent rows={18} /></ListScrollArea>}
        listLabel="List"
        showDetail
      />
    </Page>
  ),
  parameters: { docs: { description: { story: "The page header stays fixed while each split pane owns its own scroll region." } } },
};
