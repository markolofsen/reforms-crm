import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationMessage, ConversationMessageList, ConversationText } from "@hub/ui/product/conversation";
import { ConversationComposerFooter, ConversationFrame, ConversationHeader, ConversationHeaderFacts } from "@hub/ui/product/conversation-frame";
import { ConversationContext, ConversationContextActions, ConversationContextItem, ConversationContextRow } from "@hub/ui/product/conversation-context";
import { ConversationComposerEditor } from "@hub/ui/product/composer-editor";
import { IntegrationStatus } from "@hub/ui/product/integration-status";

function MailComposerDemo() {
  const [value, setValue] = useState("Здравствуйте!\n\nСпасибо за сообщение — вернёмся с деталями в ближайшее время.");
  const [saved, setSaved] = useState(false);

  return (
    <div className="h-[720px] min-w-0 max-w-5xl border bg-background">
      <ConversationFrame
        ariaLabel="Mail composer preview"
        composer={
          <ConversationComposerEditor
            ariaLabel="Mail reply composer"
            beforeEditor={
              <ConversationContext>
                <ConversationContextRow>
                  <ConversationContextItem label="From"><span className="block max-w-full truncate">Reforms &lt;hello@reforms.ai&gt;</span></ConversationContextItem>
                  <ConversationContextItem label="Brand">Reforms</ConversationContextItem>
                  <ConversationContextItem label="Language">Russian</ConversationContextItem>
                  <ConversationContextItem label="Signature"><IntegrationStatus compact detail="Regards,\nReforms team\nreforms.ai" label="Signature" state="connected" /></ConversationContextItem>
                </ConversationContextRow>
                <ConversationContextActions><span>Brand, language and signature are resolved before saving.</span></ConversationContextActions>
              </ConversationContext>
            }
            description="Saved as an unsent Mail draft."
            footer={<ConversationComposerFooter feedback={<span className="text-muted-foreground text-xs" role="status">{saved ? "Draft saved locally. Nothing is sent." : "Meta/Ctrl + Enter saves · Escape cancels"}</span>}><ActionButton onClick={() => setSaved(true)} size="s" variant="primary">Save draft</ActionButton><ActionButton onClick={() => setValue("")} size="s" variant="quiet">Clear</ActionButton></ConversationComposerFooter>}
            onCancel={() => setSaved(false)}
            onChange={(next) => { setValue(next); setSaved(false); }}
            onSubmit={() => setSaved(true)}
            placeholder="Write a reply in Markdown…"
            title="Write a reply"
            value={value}
          />
        }
        header={
          <ConversationHeader
            subtitle={
              <ConversationHeaderFacts>
                <span>hello@reforms.ai</span>
                <span>Waiting for them</span>
              </ConversationHeaderFacts>
            }
            title="Mark Effect"
          />
        }
      >
        <ConversationMessageList className="min-h-full justify-end px-0 py-5">
          <ConversationMessage author="Jovan" dateTime="2026-11-22T10:42:00Z" direction="in" time="10:42">
            <ConversationText text="Could you send the latest update for the project?" />
          </ConversationMessage>
          <ConversationMessage author="You" dateTime="2026-11-22T10:44:00Z" direction="out" time="10:44">
            <ConversationText text="We are preparing the reply and will keep the conversation in the selected brand context." />
          </ConversationMessage>
        </ConversationMessageList>
      </ConversationFrame>
    </div>
  );
}

function SignatureFallbackDemo() {
  const [value, setValue] = useState("Здравствуйте!\n\nСпасибо, что написали нам.");
  return (
    <div className="max-w-3xl border bg-background p-4">
      <ConversationComposerEditor
        ariaLabel="Fallback signature composer"
        beforeEditor={
          <ConversationContext>
            <ConversationContextRow>
              <ConversationContextItem label="From"><span className="block max-w-full truncate">Reforms &lt;hello@reforms.ai&gt;</span></ConversationContextItem>
              <ConversationContextItem label="Language">Russian</ConversationContextItem>
              <ConversationContextItem label="Signature"><IntegrationStatus compact detail="Best regards,\nReforms team\nreforms.ai\n\nNo Russian variant is configured." label="Signature" state="connected" /></ConversationContextItem>
            </ConversationContextRow>
            <ConversationContextActions tone="warning"><span role="status">No Russian signature; using English.</span></ConversationContextActions>
          </ConversationContext>
        }
        description="The draft stays unsent until the normal review flow."
        footer={<ConversationComposerFooter><ActionButton size="s" variant="primary">Save draft</ActionButton></ConversationComposerFooter>}
        onChange={setValue}
        placeholder="Write a reply in Markdown…"
        title="Language fallback"
        value={value}
      />
    </div>
  );
}

function NarrowComposerContextDemo() {
  const [value, setValue] = useState("Здравствуйте!\n\nПодтверждаем, что получили ваш запрос.");
  return (
    <div className="w-[22rem] max-w-full border bg-background p-3">
      <ConversationComposerEditor
        ariaLabel="Narrow composer context"
        beforeEditor={
          <ConversationContext>
            <ConversationContextRow>
              <ConversationContextItem label="From"><span className="block max-w-full truncate">Reforms International Support &lt;hello@reforms.ai&gt;</span></ConversationContextItem>
              <ConversationContextItem label="Language">Russian</ConversationContextItem>
              <ConversationContextItem label="Brand"><span className="block max-w-full truncate">Reforms International</span></ConversationContextItem>
              <ConversationContextItem label="Signature"><IntegrationStatus compact detail="Regards,\nReforms International team\nreforms.ai" label="Signature" state="connected" /></ConversationContextItem>
            </ConversationContextRow>
            <ConversationContextActions tone="warning"><span role="status">The selected signature is resolved from the incoming recipient address.</span></ConversationContextActions>
          </ConversationContext>
        }
        description="Context facts wrap before the editor starts."
        footer={<ConversationComposerFooter><ActionButton size="s" variant="primary">Save draft</ActionButton></ConversationComposerFooter>}
        onChange={setValue}
        placeholder="Write a reply in Markdown…"
        title="Narrow reply"
        value={value}
      />
    </div>
  );
}

function LongComposerDemo() {
  const [value, setValue] = useState(Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}: the editor body can grow without moving the conversation history or the pinned action footer.`).join("\n\n"));
  return (
    <div className="h-[560px] min-w-0 max-w-5xl border bg-background">
      <ConversationFrame
        ariaLabel="Long Mail composer preview"
        composer={
          <ConversationComposerEditor
            ariaLabel="Long Mail reply composer"
            description="The body scrolls independently; actions stay visible."
            footer={<ConversationComposerFooter><ActionButton onClick={() => setValue("")} size="s" variant="primary">Save draft</ActionButton><ActionButton onClick={() => setValue("")} size="s" variant="quiet">Clear</ActionButton></ConversationComposerFooter>}
            onChange={setValue}
            placeholder="Write a reply in Markdown…"
            title="Long reply"
            value={value}
          />
        }
        header={<ConversationHeader subtitle={<ConversationHeaderFacts><span>hello@reforms.ai</span><span>Draft stays unsent</span></ConversationHeaderFacts>} title="Mark Effect" />}
      >
        <ConversationMessageList className="min-h-full justify-end px-0 py-5">
          <ConversationMessage author="Mark" direction="in" time="10:42"><ConversationText text="The history remains readable above the composer." /></ConversationMessage>
        </ConversationMessageList>
      </ConversationFrame>
    </div>
  );
}

function ComposerStatesDemo() {
  const states = [
    { id: "idle", title: "Idle", value: "Напишите ответ клиенту…", description: "No pending action", state: "idle", disabled: false, feedback: undefined },
    { id: "editing", title: "Editing", value: "Текст редактируется перед сохранением.", description: "Save is available", state: "editing", disabled: false, feedback: undefined },
    { id: "recorded", title: "Recorded", value: "Voice transcript is ready to review.", description: "The owner can edit before saving", state: "recorded", disabled: false, feedback: "Transcript inserted from dictation." },
    { id: "saving", title: "Saving", value: "Сохраняем несрочный черновик…", description: "Mutation is in flight", state: "saving", disabled: true, feedback: "Saving draft…" },
    { id: "saved", title: "Saved", value: "Черновик сохранён, но ещё не отправлен.", description: "The draft remains unsent", state: "saved", disabled: false, feedback: "Draft saved. Nothing is sent." },
    { id: "error", title: "Error", value: "Текст остаётся доступен после ошибки.", description: "Retry keeps the text", state: "error", disabled: false, feedback: "Could not save the draft. Try again." },
    { id: "disabled", title: "Disabled", value: "Сначала выберите бренд и подпись.", description: "The editor is unavailable", state: "blocked", disabled: true, feedback: "Choose a brand before writing." },
    { id: "unavailable", title: "Mail unavailable", value: "Текст можно подготовить заранее.", description: "Saving waits for Mail context", state: "unavailable", disabled: false, feedback: "Mail context is unavailable. The text remains here." },
  ] as const;

  return (
    <div className="grid gap-3 bg-muted/20 p-4 lg:grid-cols-2">
      {states.map((item) => (
        <div className="min-w-0 overflow-hidden rounded-lg border bg-background" key={item.id}>
          <ConversationComposerEditor
            ariaLabel={`${item.title} composer`}
            description={item.description}
            disabled={item.disabled}
            footer={
              <ConversationComposerFooter feedback={item.feedback ? <span className={item.state === "error" ? "text-destructive-foreground text-xs" : "text-muted-foreground text-xs"} role={item.state === "error" ? "alert" : "status"}>{item.feedback}</span> : undefined}>
                <ActionButton disabled={item.disabled || item.id === "unavailable"} size="s" variant="primary">Save draft</ActionButton>
                <ActionButton disabled={item.disabled} size="s" variant="quiet">Clear</ActionButton>
              </ConversationComposerFooter>
            }
            notice={item.state === "error" ? <span className="text-destructive-foreground text-xs" role="alert">The last save failed.</span> : item.id === "unavailable" ? <span className="text-warning-foreground text-xs" role="status">Mail is not ready. Saving stays disabled.</span> : undefined}
            onChange={() => undefined}
            placeholder="Write a reply in Markdown…"
            state={item.state}
            title={item.title}
            value={item.value}
          />
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: "Product/Mail composer",
  component: ConversationComposerEditor,
  // The composer's required props; every scenario below renders its own state, so these only fill the props table.
  args: { ariaLabel: "Reply to Anna", title: "Write a reply", value: "", onChange: fn() },
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof ConversationComposerEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BrandAwareReply: Story = {
  render: () => <MailComposerDemo />,
  parameters: {
    docs: {
      description: {
        story: "The composer keeps the conversation above, pins actions below, and shows the resolved brand and technical address before saving an unsent draft.",
      },
    },
  },
};

export const SignatureLanguageFallback: Story = {
  render: () => <SignatureFallbackDemo />,
  parameters: {
    docs: {
      description: {
        story: "The server-resolved language remains visible and an English fallback is explicit when the selected brand has no matching signature variant.",
      },
    },
  },
};

export const NarrowContext: Story = {
  render: () => <NarrowComposerContextDemo />,
  parameters: {
    docs: {
      description: {
        story: "A narrow composer keeps long From, brand and signature facts readable without pushing the editor or pinned actions outside the viewport.",
      },
    },
  },
};

export const LongBodyKeepsFooterPinned: Story = {
  render: () => <LongComposerDemo />,
  parameters: {
    docs: {
      description: {
        story: "A long visual Markdown reply scrolls inside the composer body while the conversation history and action footer keep their own boundaries.",
      },
    },
  },
};

export const States: Story = {
  render: () => <ComposerStatesDemo />,
  parameters: {
    docs: {
      description: {
        story: "The shared composer keeps the editor body and status visible while its footer stays pinned across idle, editing, recorded, saving, saved, error, blocked and unavailable states.",
      },
    },
  },
};
