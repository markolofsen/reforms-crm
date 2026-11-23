import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandHeader } from "@hub/ui/product/brand-header";
import { FilterChips, type Chip } from "@hub/ui/product/filter-chips";
import { IntegrationStatus } from "@hub/ui/product/integration-status";
import { Page, SectionTitle } from "@hub/ui/product/page";
import { ActionButton } from "@hub/ui/product/action-button";

const views = [
  { value: "needs", label: "Needs you", count: 2 },
  { value: "waiting", label: "Waiting", count: 8 },
  { value: "all", label: "All", count: 44 },
] satisfies Chip<string>[];

function IdentityAndFilters() {
  const [view, setView] = useState("needs");
  return (
    <Page flush scroll={false}>
      <div className="flex min-h-0 flex-1 flex-col bg-muted/20">
        <div className="flex min-h-14 items-center justify-between border-b bg-background px-4">
          <BrandHeader className="-ms-2" name="Hub SaaS" />
          <ActionButton size="s" variant="secondary">Settings</ActionButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            <div>
              <SectionTitle id="list-view-title">Conversation view</SectionTitle>
              <p className="mt-1 text-muted-foreground text-sm">One compact filter row keeps the list readable and leaves the conversation column uncluttered.</p>
            </div>
            <FilterChips chips={views} label="Conversation view" onChange={setView} value={view} />
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-background p-4">
              <span className="font-medium text-sm">Contact integrations</span>
              <IntegrationStatus detail="Notion · Mark Effect" label="Notion" state="connected" />
              <IntegrationStatus detail="No matching Notion page" label="Notion" state="not_found" />
              <IntegrationStatus detail="Notion directory is unavailable" label="Notion" state="unavailable" />
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-background p-4">
              <span className="font-medium text-sm">Compact contact markers</span>
              <IntegrationStatus compact detail="Notion · Mark Effect" label="Notion" state="connected" />
              <IntegrationStatus compact detail="No matching Notion page" label="Notion" state="not_found" />
              <IntegrationStatus compact detail="Notion directory is unavailable" label="Notion" state="unavailable" />
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">{views.find((item) => item.value === view)?.label}</p>
              <p className="mt-1 text-muted-foreground text-sm">The selected state remains visible in the control and is keyboard navigable.</p>
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}

const meta = {
  title: "Product/Identity and filters",
  component: IdentityAndFilters,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof IdentityAndFilters>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CompactListChrome: Story = {
  render: () => <IdentityAndFilters />,
};
