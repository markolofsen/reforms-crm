import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionButton } from "@hub/ui/product/action-button";
import { AgentPanelFrame } from "@hub/ui/product/agent-panel";
import { ConversationHeader } from "@hub/ui/product/conversation-frame";
import { SideDock, DOCK_WIDTH } from "@hub/ui/product/side-dock";
import { TerminalDictationButton, TerminalView, type TerminalHandle, type TerminalSize } from "@hub/ui/product/terminal";
import { useResolvedTheme } from "@hub/ui/product/theme";
import { useHotkey } from "@hub/ui/use-hotkey";

type AgentPanelProps = {
  initialOpen?: boolean;
};

function AgentPanel({ initialOpen = true }: AgentPanelProps) {
  const [open, setOpen] = useState(initialOpen);
  const [width, setWidth] = useState<number>(DOCK_WIDTH.default);
  const [status, setStatus] = useState("Waiting for an agent");
  const [terminalSize, setTerminalSize] = useState<TerminalSize | null>(null);
  const screen = useRef<TerminalHandle | null>(null);
  const resolvedTheme = useResolvedTheme();
  useHotkey("mod+j", () => setOpen((current) => !current), true);

  if (!open) {
    return (
      <div className="flex h-[700px] min-w-0 flex-col bg-muted/20 p-6">
        <ActionButton onClick={() => setOpen(true)} variant="primary">
          Open agent panel
        </ActionButton>
      </div>
    );
  }

  return (
    <div className="flex h-[700px] min-w-0 overflow-hidden border bg-background">
      <main className="flex min-w-0 flex-1 flex-col">
        <ConversationHeader
          title="Conversation workspace"
          subtitle="A shared shell keeps the work surface and agent dock independent"
          actions={
            <ActionButton onClick={() => setOpen(false)} size="s" tooltip={{ content: "Hide agent panel", hotkey: "Meta/Ctrl + J" }} variant="quiet">
              Hide panel
            </ActionButton>
          }
        />
        <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-md space-y-2">
            <p className="font-medium">The main conversation remains readable</p>
            <p className="text-muted-foreground text-sm">The dock is a reusable product surface. Runtime sessions supply data; the shared UI owns layout, resize and dictation affordances.</p>
          </div>
        </div>
      </main>
      <SideDock label="Agent panel" onWidth={setWidth} width={width}>
        <AgentPanelFrame
          header={<ConversationHeader title="Agent" subtitle={terminalSize ? `${status} · ${terminalSize.cols}×${terminalSize.rows}` : status} />}
          footer={<TerminalDictationButton screen={screen} />}
        >
          <div className="min-h-0 flex-1 p-2">
            <TerminalView
              className="h-full rounded-md border"
              inputLabel="Agent terminal input"
              onInput={(bytes) => setStatus(`Received ${bytes.byteLength} bytes`)}
              onLink={(uri) => setStatus(`Opened ${uri}`)}
              onReady={(handle) => {
                screen.current = handle;
                handle.write(new TextEncoder().encode("$ hub agent\r\nReady for a focused task.\r\n"));
                setStatus("Agent is ready");
              }}
              onSize={setTerminalSize}
              resolvedTheme={resolvedTheme}
            />
          </div>
        </AgentPanelFrame>
      </SideDock>
    </div>
  );
}

function DictationUnavailableDemo() {
  const [ready, setReady] = useState(false);
  const screen = useRef<TerminalHandle | null>({ focus: () => undefined, paste: () => undefined, reset: () => undefined, write: () => undefined });
  useEffect(() => {
    const browser = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    const previous = { speech: browser.SpeechRecognition, webkit: browser.webkitSpeechRecognition };
    browser.SpeechRecognition = undefined;
    browser.webkitSpeechRecognition = undefined;
    setReady(true);
    return () => {
      browser.SpeechRecognition = previous.speech;
      browser.webkitSpeechRecognition = previous.webkit;
    };
  }, []);
  if (!ready) return <div className="p-6 text-muted-foreground text-sm">Preparing browser capability fixture…</div>;
  return <div className="max-w-xl border bg-background"><TerminalDictationButton screen={screen} /></div>;
}

const meta = {
  title: "Product/Agent panel",
  component: AgentPanel,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof AgentPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const Collapsed: Story = {
  args: { initialOpen: false },
  parameters: { docs: { description: { story: "The dock collapses to a clear reopen action without removing the agent surface from the page contract." } } },
};

export const DictationUnavailable: Story = {
  render: () => <DictationUnavailableDemo />,
  parameters: {
    docs: {
      description: {
        story: "Chrome capability errors remain visible beside the voice control instead of silently removing the dictation affordance.",
      },
    },
  },
};
