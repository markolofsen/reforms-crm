import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationList, ConversationListIdentity, ConversationListItem, ConversationMessage, ConversationMessageList, ConversationText } from "@hub/ui/product/conversation";
import { ConversationBackButton, ConversationComposer, ConversationComposerFooter, ConversationFrame, ConversationHeader } from "@hub/ui/product/conversation/frame";
import { IntegrationStatus, type IntegrationStatusState } from "@hub/ui/product/integration-status";
import { Input } from "@hub/ui/input";
import { ListDetail, ListScrollArea } from "@hub/ui/product/list/detail";
import { ListToolbar, ListToolbarRow } from "@hub/ui/product/list/toolbar";
import { Page } from "@hub/ui/product/shell/page";
import { Spinner } from "@hub/ui/spinner";

const people = [
  { name: "Alex Morgan", detail: "Waiting for you · Question about data updates", notion: "connected" as const, time: "3 d ago" },
  { name: "IT-Helpdesk", detail: "Draft ready · Access Renewal", notion: "not_found" as const, time: "7 d ago" },
  { name: "Northwind Motors", detail: "New lead · Carapis", notion: "connected" as const, time: "1 h ago" },
  { name: "koreana", detail: "New lead · Carapis", notion: "unavailable" as const, time: "10 h ago" },
  { name: "cost2cost cars", detail: "New lead · Carapis", notion: "connected" as const, time: "29 h ago" },
];

function ListDetailDemo() {
  const [selected, setSelected] = useState<number | null>(0);
  const [refreshing, setRefreshing] = useState(false);
  const focusTarget = useRef<HTMLButtonElement>(null);
  const person = people[selected ?? 0] ?? people[0]!;

  return (
    <div className="h-[720px] min-w-0 max-w-6xl border bg-background">
      <Page flush nav={<span className="font-medium">Conversation workspace</span>} scroll={false}>
        <ListDetail
        detail={
          <ConversationFrame
            ariaLabel={`Conversation with ${person.name}`}
            composer={
              <ConversationComposer
                ariaLabel="Reply composer"
                footer={<ConversationComposerFooter feedback={<span className="text-muted-foreground text-xs">Composer stays docked below history.</span>}><ActionButton size="s" variant="primary">Save draft</ActionButton></ConversationComposerFooter>}
              >
                <p className="text-muted-foreground text-sm">Write a new unsent draft for this conversation.</p>
              </ConversationComposer>
            }
            header={<ConversationHeader back={<ConversationBackButton label="Back to people" onClick={() => setSelected(null)} onRestoreFocus={() => focusTarget.current?.focus()} />} subtitle={`Mail · ${person.detail}`} title={person.name} />}
          >
            <ConversationMessageList className="mx-auto min-h-[900px] max-w-2xl justify-end">
              <ConversationMessage author={person.name} direction="in" time={person.time}>
                <ConversationText text={`${person.detail}. The history scrolls independently from the contact list.`} />
              </ConversationMessage>
              <ConversationMessage author="You" direction="out" time="just now">
                <ConversationText text="The selected person stays visible while the right column owns its own scroll." />
              </ConversationMessage>
            </ConversationMessageList>
          </ConversationFrame>
        }
        detailLabel="Conversation"
        list={
          <ListScrollArea ariaBusy={refreshing}>
            <ListToolbar ariaLabel="People filters and actions">
              <ListToolbarRow>
                <div className="min-w-0 shrink-0">
                  <h2 className="font-semibold text-base">People</h2>
                  <p className="text-muted-foreground text-xs">Choose a conversation</p>
                </div>
                <div className="min-w-0 flex-1 @max-3xl:order-last @max-3xl:basis-full">
                  <Input aria-label="Search people" className="control-s w-full" placeholder="Search people or messages" type="search" />
                </div>
                <ActionButton size="s" variant="secondary">Select</ActionButton>
                <ActionButton aria-pressed={refreshing} onClick={() => setRefreshing((value) => !value)} size="s" variant="quiet">
                  {refreshing ? <><Spinner aria-hidden="true" className="size-3" /> Updating</> : "Refresh"}
                </ActionButton>
              </ListToolbarRow>
            </ListToolbar>
            <ConversationList ariaLabel="People">
              {people.map((item, index) => (
                <ConversationListItem key={item.name} open={index === selected} selected={index === selected}>
                  <ActionButton className="h-auto min-h-16 w-full justify-start rounded-none border-0 px-3 py-3 text-start" onClick={() => setSelected(index)} ref={index === selected ? focusTarget : undefined} size="s" variant="quiet">
                    <ConversationListIdentity marker={<IntegrationStatus compact detail={`Notion · ${item.name}`} label="Notion" state={item.notion as IntegrationStatusState} />} name={item.name} time={item.time} />
                    <span className="truncate text-muted-foreground text-xs">{item.detail}</span>
                  </ActionButton>
                </ConversationListItem>
              ))}
            </ConversationList>
          </ListScrollArea>
        }
        listLabel="People"
        showDetail={selected !== null}
        />
      </Page>
    </div>
  );
}

const meta = {
  title: "Product/List detail",
  component: ListDetail,
  // The split's required props; the scenario renders its own state, so these only fill the props table.
  args: { list: null, detail: null, showDetail: false, listLabel: "People", detailLabel: "Conversation" },
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof ListDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MailAndMessengerSplitView: Story = {
  render: () => <ListDetailDemo />,
  parameters: {
    docs: {
      description: {
        story: "The list and conversation columns keep fixed height, own independent scrolling, leave the composer docked at the bottom, and expose the list's aria-busy refresh state through the Refresh control.",
      },
    },
  },
};

