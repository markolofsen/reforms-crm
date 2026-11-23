import { useRef, useState, type ReactNode, type Ref } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExternalLinkIcon } from "lucide-react";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationDayDivider, ConversationLabel, ConversationMessage, ConversationMessageList, ConversationText } from "@hub/ui/product/conversation";
import { ConversationBackButton, ConversationComposer, ConversationComposerFooter, ConversationEmptyState, ConversationFrame, ConversationHeader, ConversationHeaderFacts, ConversationHistoryContent, ConversationHistoryNotice, ConversationHistoryState, ConversationHistorySummary, ConversationRefreshing, ConversationScrollToLatest, ConversationStaleNotice } from "@hub/ui/product/conversation-frame";
import { useConversationScroll } from "@hub/ui/product/conversation-scroll";
import { ConversationEditorSurface } from "@hub/ui/product/composer-editor";
import { PlainTextEditor } from "@hub/ui/product/plain-text-editor";

function ConversationDemo() {
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div className="h-[720px] min-w-0 max-w-5xl border bg-background">
      <ConversationFrame
        ariaLabel="Conversation preview"
        composer={
          <ConversationComposer
            ariaLabel="Reply composer"
            footer={<ConversationComposerFooter><ActionButton onClick={() => setSent(true)} size="s" variant="primary">Save draft</ActionButton><span className="text-muted-foreground text-xs">Nothing is sent from this editor.</span></ConversationComposerFooter>}
          >
            <PlainTextEditor
              ariaLabel="Reply"
              onChange={setDraft}
              onSubmit={() => setSent(true)}
              placeholder="Write a reply…"
             
              value={draft}
            />
          </ConversationComposer>
        }
        header={
          <ConversationHeader
            actions={<ActionButton size="s" variant="quiet">Open in Notion</ActionButton>}
            subtitle={<ConversationHeaderFacts><span>Telegram</span><span>Draft replies</span><span>Notion contact linked</span></ConversationHeaderFacts>}
            title="Евгений"
          />
        }
      >
        <ConversationMessageList className="py-4">
          <ConversationMessage author="Евгений" direction="in" time="10:42"><ConversationText text="Можешь проверить последний отчёт?" /></ConversationMessage>
          <ConversationMessage author="You" direction="out" time="10:44"><ConversationText text="Да, посмотрю и вернусь с комментариями." /></ConversationMessage>
          <ConversationMessage author="Евгений" direction="in" time="10:45"><ConversationText text={`Спасибо. ${sent ? "Ответ сохранён в unsent draft." : ""}`} /></ConversationMessage>
        </ConversationMessageList>
      </ConversationFrame>
    </div>
  );
}

function FrameState({ children, className = "h-[620px] min-w-0 max-w-5xl" }: { children: ReactNode; className?: string }) {
  return <div className={`${className} border bg-background`}>{children}</div>;
}

function ConversationState({ title, children, historyActions, historyRef }: { title: string; children: ReactNode; historyActions?: ReactNode; historyRef?: Ref<HTMLElement> }) {
  return (
    <ConversationFrame ariaLabel={`${title} conversation`} header={<ConversationHeader title={title} />} historyActions={historyActions}>
      <ConversationHistoryContent ariaLabel={`${title} history`} historyRef={historyRef}>{children}</ConversationHistoryContent>
    </ConversationFrame>
  );
}

function LoadingDemo() {
  return (
    <FrameState>
      <ConversationState title="Loading">
        <ConversationHistoryState><div className="text-center text-muted-foreground text-sm" role="status">Opening the conversation…</div></ConversationHistoryState>
      </ConversationState>
    </FrameState>
  );
}

function EmptyDemo() {
  return (
    <FrameState>
      <ConversationState title="Empty">
        <ConversationHistoryState className="flex-col gap-2 text-center">
          <p className="font-medium">No messages yet</p>
          <p className="max-w-sm text-muted-foreground text-sm">Write a new unsent message below, or wait for the client to start the conversation.</p>
        </ConversationHistoryState>
      </ConversationState>
    </FrameState>
  );
}

function NoSelectionDemo() {
  return (
    <FrameState>
      <ConversationEmptyState subtitle="Choose a conversation from the list">
        <div className="flex max-w-sm flex-col gap-2 text-center">
          <p className="font-medium">Nothing to open</p>
          <p className="text-muted-foreground text-sm">The selected conversation will keep this same header and history geometry.</p>
        </div>
      </ConversationEmptyState>
    </FrameState>
  );
}

function NoInboundDemo() {
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <FrameState className="h-[680px] min-w-0 max-w-5xl">
      <ConversationFrame
        ariaLabel="New message conversation"
        composer={
          <ConversationComposer
            ariaLabel="New message composer"
            notice={<p className="text-muted-foreground text-sm">No incoming message is open. This starts a new unsent draft.</p>}
            footer={<ConversationComposerFooter feedback={<span className="text-muted-foreground text-xs">Nothing is sent from this editor.</span>}><ActionButton disabled={!draft.trim()} onClick={() => setSaved(true)} size="s" variant="primary">{saved ? "Saved" : "Save draft"}</ActionButton></ConversationComposerFooter>}
            state={saved ? "saved" : draft.trim() ? "editing" : "idle"}
          >
            <PlainTextEditor ariaLabel="Write a new message" onChange={(next) => { setDraft(next); setSaved(false); }} onSubmit={() => setSaved(true)} placeholder="Write a new message…" value={draft} />
          </ConversationComposer>
        }
        header={<ConversationHeader subtitle="Telegram · no reply pending" title="Евгений" />}
      >
        <ConversationMessageList className="py-4">
          <ConversationMessage author="You" direction="out" time="10:44"><ConversationText text="Последнее исходящее сообщение уже здесь." /></ConversationMessage>
        </ConversationMessageList>
      </ConversationFrame>
    </FrameState>
  );
}

function ErrorDemo() {
  const [retried, setRetried] = useState(false);
  return (
    <FrameState>
      <ConversationState title="Error">
        <ConversationHistoryState className="flex-col gap-3 text-center">
          <p className="font-medium">The conversation could not be loaded</p>
          <p className="max-w-md text-muted-foreground text-sm">The saved list is still available. Retry the conversation without clearing the selected contact.</p>
          <ActionButton onClick={() => setRetried(true)} size="s" variant="secondary">{retried ? "Retrying…" : "Retry"}</ActionButton>
          {retried && <p className="text-muted-foreground text-xs" role="status">Retry requested.</p>}
        </ConversationHistoryState>
      </ConversationState>
    </FrameState>
  );
}

function TransitionDemo() {
  const [state, setState] = useState<"loading" | "error" | "missing">("loading");
  const history = state === "loading" ? (
    <ConversationHistoryState><div className="text-center text-muted-foreground text-sm" role="status">Opening the conversation…</div></ConversationHistoryState>
  ) : state === "error" ? (
    <ConversationHistoryState className="flex-col gap-3 text-center">
      <p className="font-medium">The conversation could not be loaded</p>
      <p className="max-w-sm text-muted-foreground text-sm">The header and back action stay mounted while the history retries.</p>
      <ActionButton onClick={() => setState("loading")} size="s" variant="secondary">Retry</ActionButton>
    </ConversationHistoryState>
  ) : (
    <ConversationHistoryState className="flex-col gap-3 text-center">
      <p className="font-medium">Conversation not found</p>
      <p className="max-w-sm text-muted-foreground text-sm">The selected route stays stable while the owner chooses where to go next.</p>
      <ActionButton onClick={() => setState("loading")} size="s" variant="secondary">Open again</ActionButton>
    </ConversationHistoryState>
  );
  return (
    <FrameState>
      <ConversationFrame
        ariaLabel="Stable conversation transition"
        header={<ConversationHeader actions={<div className="flex gap-1"><ActionButton onClick={() => setState("error")} size="s" variant="quiet">Error</ActionButton><ActionButton onClick={() => setState("missing")} size="s" variant="quiet">Missing</ActionButton></div>} back={<ConversationBackButton onClick={() => setState("loading")} />} subtitle="Telegram · selected contact" title="Евгений" />}
      >
        {history}
      </ConversationFrame>
    </FrameState>
  );
}

function StaleHistoryDemo() {
  const [retrying, setRetrying] = useState(false);
  return (
    <FrameState>
      <ConversationFrame ariaLabel="Stale conversation" header={<ConversationHeader subtitle="Telegram · last loaded copy" title="Евгений" />}>
        <ConversationHistoryContent ariaLabel="Stale conversation history">
          {retrying && <ConversationRefreshing />}
          <ConversationHistoryNotice><ConversationStaleNotice detail="The refresh failed, but the last readable messages remain available." onRetry={() => { setRetrying(true); window.setTimeout(() => setRetrying(false), 500); }} retrying={retrying} /></ConversationHistoryNotice>
          <ConversationMessageList>
            <ConversationMessage author="Евгений" direction="in" time="10:42"><ConversationText text="История остаётся доступной, пока Hub повторяет запрос." /></ConversationMessage>
            <ConversationMessage author="You" direction="out" time="10:44"><ConversationText text="Контекст не исчезает из-за временной ошибки обновления." /></ConversationMessage>
          </ConversationMessageList>
        </ConversationHistoryContent>
      </ConversationFrame>
    </FrameState>
  );
}

function DraftEditingDemo() {
  const [value, setValue] = useState("## Ответ клиенту\n\nПроверяю детали и вернусь с подтверждением.");
  const [saved, setSaved] = useState(false);
  return (
    <FrameState className="h-[680px] min-w-0 max-w-5xl">
      <ConversationFrame
        ariaLabel="Messenger draft editing"
        composer={
          <ConversationComposer
            ariaLabel="Messenger draft and actions"
            footer={
              <ConversationComposerFooter feedback={<span className="text-muted-foreground text-xs">Meta/Ctrl + Enter saves · Esc cancels</span>}>
                <ActionButton onClick={() => setSaved(true)} size="s" variant="secondary">{saved ? "Saved" : "Save"}</ActionButton>
                <ActionButton onClick={() => setValue("")} size="s" variant="quiet">Cancel</ActionButton>
              </ConversationComposerFooter>
            }
            state={saved ? "saved" : value.trim() ? "editing" : "idle"}
          >
            <ConversationEditorSurface ariaLabel="Edit the messenger draft" description="Your words for this reply. The editor scrolls; actions stay visible." onChange={(next) => { setValue(next); setSaved(false); }} onSubmit={() => setSaved(true)} title="Edit draft" value={value} />
          </ConversationComposer>
        }
        header={<ConversationHeader subtitle="Telegram · Draft ready · owner review" title="Евгений" />}
      >
        <ConversationMessageList className="py-4">
          <ConversationMessage author="Евгений" direction="in" time="10:42"><ConversationText text="Проверь, пожалуйста, детали." /></ConversationMessage>
          <ConversationMessage author="You" direction="out" time="10:44"><ConversationText text="Готовлю ответ без отправки." /></ConversationMessage>
        </ConversationMessageList>
      </ConversationFrame>
    </FrameState>
  );
}

function NarrowDemo() {
  const [draft, setDraft] = useState("");
  return (
    <FrameState className="h-[680px] w-[360px]">
      <ConversationFrame
        ariaLabel="Narrow conversation"
        composer={
          <ConversationComposer ariaLabel="Narrow reply composer" footer={<ConversationComposerFooter feedback={<span className="text-muted-foreground text-xs">Meta/Ctrl + Enter saves</span>}><ActionButton onClick={() => undefined} size="s" variant="primary">Save draft</ActionButton></ConversationComposerFooter>}>
            <PlainTextEditor ariaLabel="Narrow reply" onChange={setDraft} onSubmit={() => undefined} value={draft} />
          </ConversationComposer>
        }
        header={<ConversationHeader actions={<><ActionButton aria-label="Open Notion" icon size="s" tooltip="Open Notion" variant="quiet"><ExternalLinkIcon aria-hidden="true" /></ActionButton><ActionButton aria-label="Open source message" icon size="s" tooltip="Open source message" variant="quiet"><ExternalLinkIcon aria-hidden="true" /></ActionButton></>} back={<ConversationBackButton label="Back to conversations" onClick={() => undefined} />} subtitle={<ConversationHeaderFacts><span>WhatsApp</span><span>Draft ready</span><ConversationLabel className="min-w-0 max-w-[min(24rem,45vw)] truncate" value="very.long.client.address+support@example.com" /></ConversationHeaderFacts>} title="A very long client name" />}
      >
        <ConversationMessageList className="py-4">
          <ConversationMessage author="A very long client name" direction="in" time="10:42"><ConversationText text="The compact bubble header keeps the message inside the narrow conversation." /></ConversationMessage>
          <ConversationMessage author="You" direction="out" time="10:44"><ConversationText text="The outgoing bubble stays on the right and keeps its blue semantic surface." /></ConversationMessage>
        </ConversationMessageList>
      </ConversationFrame>
    </FrameState>
  );
}

function NarrowHeaderActionsDemo() {
  return (
    <FrameState className="h-[360px] w-[360px]">
      <ConversationFrame
        ariaLabel="Narrow conversation header actions"
        header={<ConversationHeader actions={<ActionButton size="s" variant="secondary">Open client in Notion</ActionButton>} subtitle={<ConversationHeaderFacts><span>Telegram</span><span>Draft ready</span></ConversationHeaderFacts>} title="A very long conversation title that must stay readable" />}
      >
        <ConversationHistoryContent ariaLabel="Narrow conversation header actions history">
          <ConversationHistoryState className="flex-col gap-2 text-center">
            <p className="font-medium">Header actions wrap safely</p>
            <p className="max-w-xs text-muted-foreground text-sm">The title and context remain readable when a labeled action cannot fit beside them.</p>
          </ConversationHistoryState>
        </ConversationHistoryContent>
      </ConversationFrame>
    </FrameState>
  );
}

function ContinuousHistoryDemo() {
  const historyRef = useRef<HTMLElement>(null);
  const scrollState = useConversationScroll(historyRef, "storybook-continuous");
  return (
    <FrameState>
      <ConversationState historyActions={!scrollState.atLatest && <ConversationScrollToLatest onClick={scrollState.scrollToLatest} />} historyRef={historyRef} title="Continuous history">
        <ConversationHistorySummary>Earlier: 12 messages are not shown; open the source to read them.</ConversationHistorySummary>
        <ConversationMessageList className="py-4">
          <ConversationDayDivider label="22 Nov 2026" />
          <ConversationMessage author="Mark" direction="in" meta="Mail · Reforms" time="09:20">
            <ConversationText text="The earlier message is rendered in the timeline itself, not hidden behind an expand control." />
          </ConversationMessage>
          <ConversationMessage author="A very long client identity" direction="in" meta="Mail · a very long receiving address or subject" time="09:22">
            <ConversationLabel value="Long metadata stays compact and is available on hover." />
          </ConversationMessage>
          <ConversationMessage author="You" direction="out" meta="Mail · Reforms" time="09:24">
            <ConversationText text="Our outgoing reply stays on the right with the primary blue surface, while the client's message stays neutral on the left." />
          </ConversationMessage>
          <ConversationMessage author="Mark" direction="in" meta="Mail · Reforms" time="09:31">
            <ConversationText text={'A longer plain-text message remains readable as one bubble. It wraps naturally and keeps https://example.test/docs clickable without requiring a second expanded state.'} />
          </ConversationMessage>
          <ConversationMessage author="Mark" direction="in" meta="Mail · Markdown" time="09:34">
            <ConversationText format="markdown" text={"## Next steps\n\nKeep the full thread visible across multiple lines.\nThis paragraph stays together instead of turning every line into a separate block.\n\n### Context\n\n- Keep the full thread visible\n- Keep the composer pinned\n\n> This quote stays readable\n> across multiple lines without a side stripe."} />
          </ConversationMessage>
          <ConversationMessage author="You" direction="out" meta="Mail · Reforms" time="09:36">
            <ConversationText text="The owner can read the whole visible conversation before choosing an action in the pinned composer." />
          </ConversationMessage>
          <ConversationDayDivider label="23 Nov 2026" />
          <ConversationMessage author="Mark" direction="in" meta="Mail · Reforms" time="08:12">
            <ConversationText text="A date boundary keeps a long history scannable without hiding any message." />
          </ConversationMessage>
        </ConversationMessageList>
      </ConversationState>
    </FrameState>
  );
}

const meta = {
  title: "Product/Conversation frame",
  component: ConversationFrame,
  // The frame's required props; every scenario below renders its own state, so these only fill the props table.
  args: { ariaLabel: "Conversation with Anna", header: <ConversationHeader title="Anna" />, children: null },
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof ConversationFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MailAndMessengerShell: Story = {
  render: () => <ConversationDemo />,
};

export const Loading: Story = {
  render: () => <LoadingDemo />,
};

export const Empty: Story = {
  render: () => <EmptyDemo />,
};

export const NoSelection: Story = {
  render: () => <NoSelectionDemo />,
  parameters: { docs: { description: { story: "The unselected Mail and Messenger detail pane uses the shared frame instead of a floating empty state, so selection does not move the layout." } } },
};

export const NoInboundComposer: Story = {
  render: () => <NoInboundDemo />,
  parameters: { docs: { description: { story: "The owner can start an unsent message even when no incoming request is open; the explanation and actions stay pinned with the composer." } } },
};

export const ErrorWithRetry: Story = {
  render: () => <ErrorDemo />,
};

export const StableTransitionShell: Story = {
  render: () => <TransitionDemo />,
  parameters: { docs: { description: { story: "Loading, error and not-found states stay inside the history pane while the conversation header and back action keep their geometry." } } },
};

export const StaleHistory: Story = {
  render: () => <StaleHistoryDemo />,
  parameters: { docs: { description: { story: "A refresh failure keeps the last loaded messages visible and places retry feedback above the history instead of replacing it with an empty error." } } },
};

export const DraftEditingFooter: Story = {
  render: () => <DraftEditingDemo />,
  parameters: { docs: { description: { story: "Long draft editing keeps the plain-text editor scrollable while Save and Cancel remain pinned below the conversation." } } },
};

export const NarrowWidth: Story = {
  render: () => <NarrowDemo />,
};

export const NarrowHeaderActions: Story = {
  render: () => <NarrowHeaderActionsDemo />,
  parameters: { docs: { description: { story: "Long header actions use a full wrapped row below the split breakpoint instead of squeezing the conversation identity." } } },
};

export const ContinuousHistory: Story = {
  render: () => <ContinuousHistoryDemo />,
  parameters: { docs: { description: { story: "Conversation messages are visible in one continuous history: date boundaries improve scanning, incoming bubbles are left/neutral, outgoing bubbles are right/blue, and no message body needs an expand control." } } },
};

export const KeyboardOwnedByEditor: Story = {
  render: () => <ConversationDemo />,
  parameters: { docs: { description: { story: "Focus the plain-text editor: Meta/Ctrl + Enter saves and Escape cancels without invoking shell hotkeys." } } },
};
