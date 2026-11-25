import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "@hub/ui/input";
import { ActionButton } from "@hub/ui/product/action-button";
import { TelegramIcon, WhatsAppIcon } from "@hub/ui/product/conversation/channel-icons";
import { DataTable, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";
import { Field, Progress } from "@hub/ui/product/field";
import { ListFilterMenu } from "@hub/ui/product/list/toolbar";
import { Spotlight } from "@hub/ui/product/spotlight";

function DataTableDemo() {
  return (
    <div className="mx-auto max-h-[420px] max-w-3xl overflow-auto border bg-background">
      <DataTable>
        <TableCaption className="sr-only">Recent client activity</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[34%]">Client</TableHead>
            <TableHead className="w-[24%]">Brand</TableHead>
            <TableHead>Last activity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[
            ["Alex Morgan", "Carapis", "Waiting for a reply"],
            ["Bluebird Labs", "Reforms", "Draft ready"],
            ["IT-Helpdesk", "CMDOP", "7 days ago"],
            ["Northwind Motors", "Carapis", "New lead"],
          ].map(([client, brand, activity]) => (
            <TableRow key={client}>
              <TableCell className="font-medium">{client}</TableCell>
              <TableCell>{brand}</TableCell>
              <TableCell className="text-muted-foreground">{activity}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
    </div>
  );
}

function FieldProgressDemo() {
  const [value, setValue] = useState("hello@reforms.ai");
  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 border bg-background p-5">
      <Field htmlFor="storybook-address" hint="The technical address stays separate from the brand display name." label="Reply address">
        <Input id="storybook-address" onChange={(event) => setValue(event.target.value)} value={value} />
      </Field>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">Knowledge indexed</span>
          <span className="text-muted-foreground tabular-nums">72 / 100</span>
        </div>
        <Progress label="Knowledge indexed: 72 of 100" max={100} value={72} />
      </div>
    </div>
  );
}

function ChannelIconsDemo() {
  return (
    <div className="mx-auto flex max-w-md flex-wrap gap-3 border bg-background p-5">
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><TelegramIcon aria-hidden="true" className="size-4 text-info-foreground" />Telegram</div>
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><WhatsAppIcon aria-hidden="true" className="size-4 text-success-foreground" />WhatsApp</div>
    </div>
  );
}

function SpotlightDemo() {
  const [run, setRun] = useState(0);
  const [outcome, setOutcome] = useState("Click the button to show where the agent is pointing.");
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 border bg-background p-5" data-story-root="spotlight">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Agent focus</p>
          <p className="text-muted-foreground text-sm">The overlay follows rows without taking focus from the owner.</p>
        </div>
        <ActionButton onClick={() => setRun((current) => current + 1)} size="s" variant="secondary">Point at clients</ActionButton>
      </div>
      <ul className="divide-y rounded-md border" aria-label="Clients">
        {["Bluebird Labs", "Alex Morgan", "Northwind Motors"].map((name, index) => (
          <li className="px-3 py-2 text-sm" data-agent-ref={`client:${index + 1}`} key={name}>{name}</li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs" role="status">{outcome}</p>
      {run > 0 && <Spotlight key={run} attribute="data-agent-ref" note="Review this client" onOutcome={(next, missing) => setOutcome(missing.length > 0 ? `${next}; missing: ${missing.join(", ")}` : next)} refs={["client:1", "client:2"]} root="[data-story-root=spotlight]" ttlMs={3000} />}
    </div>
  );
}

function FilterMenuDemo() {
  const [view, setView] = useState("needs-you");
  const [channel, setChannel] = useState("all");
  return (
    <div className="mx-auto flex min-h-[280px] max-w-md flex-col gap-4 border bg-background p-5">
      <div>
        <p className="font-medium">Compact filter menu</p>
        <p className="text-muted-foreground text-sm">Desktop stays dense; touch layouts keep each choice easy to hit.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ListFilterMenu
          name="View"
          onChange={setView}
          options={[{ value: "needs-you", label: "Needs you", count: 2, group: "Views" }, { value: "all", label: "All conversations", group: "Views" }, { value: "sequence-steps", label: "Sequence steps", count: 1, group: "Filters" }]}
          tooltip="Choose list view"
          value={view}
        />
        <ListFilterMenu name="Channel" onChange={setChannel} tooltip="Choose channel" options={[{ value: "all", label: "All" }, { value: "telegram", label: "Telegram" }, { value: "whatsapp", label: "WhatsApp" }]} value={channel} />
      </div>
      <p className="text-muted-foreground text-xs" role="status">Selected view: {view} · channel: {channel}</p>
    </div>
  );
}

const meta = {
  title: "Product/Surfaces",
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const DataTableSurface: Story = {
  render: () => <DataTableDemo />,
};

export const FieldAndProgress: Story = {
  render: () => <FieldProgressDemo />,
};

export const ChannelIcons: Story = {
  render: () => <ChannelIconsDemo />,
};

export const AgentSpotlight: Story = {
  render: () => <SpotlightDemo />,
  parameters: {
    docs: {
      description: {
        story: "The same spotlight contract used by agent guidance: it points at live refs, announces the outcome and expires without stealing focus.",
      },
    },
  },
};

export const FilterMenu: Story = {
  render: () => <FilterMenuDemo />,
  parameters: {
    docs: {
      description: {
        story: "Shared menus keep the compact desktop rhythm while meeting the 44px touch-target contract below 1024px.",
      },
    },
  },
};
