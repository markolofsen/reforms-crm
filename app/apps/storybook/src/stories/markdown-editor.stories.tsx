import { useCallback, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ActionButton } from "@hub/ui/product/action-button";
import { MarkdownEditor } from "@hub/ui/product/composer/markdown-editor";
import { useHotkey } from "@hub/ui/use-hotkey";

function MarkdownEditorDemo() {
  const [value, setValue] = useState("## Ответ клиенту\n\nТекст поддерживает **Markdown**, ~~зачёркивание~~, списки и цитаты.\n\n- Заголовки\n- Форматирование\n\n> Всё сохраняется как Markdown.\n\n[Открыть справку](https://example.com)\n\n---");
  const [message, setMessage] = useState("Редактор готов");

  return (
    <div className="mx-auto flex min-h-[480px] max-w-3xl flex-col gap-4 bg-muted/20 p-6">
      <MarkdownEditor autoFocus onCancel={() => setMessage("Редактирование отменено")} onChange={setValue} onSubmit={() => setMessage("Черновик сохранён")} value={value} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm" role="status">{message}</p>
        <ActionButton onClick={() => setMessage("Черновик сохранён")} variant="primary">Save draft</ActionButton>
      </div>
    </div>
  );
}

function ShortcutOwnershipDemo() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [value, setValue] = useState("Выделите слово и нажмите Meta/Ctrl+B внутри редактора.");
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  useHotkey("mod+b", toggleSidebar);

  return (
    <div className="mx-auto flex min-h-[480px] max-w-3xl flex-col gap-4 bg-muted/20 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Editor owns Meta/Ctrl+B</p>
          <p className="text-muted-foreground text-sm">Outside the editor the same shortcut toggles the shell panel; while typing it stays available for formatting.</p>
        </div>
        <ActionButton onClick={toggleSidebar} size="s" variant="secondary">{sidebarOpen ? "Panel open" : "Panel closed"}</ActionButton>
      </div>
      <MarkdownEditor ariaLabel="Shortcut ownership editor" onChange={setValue} value={value} />
      <p className="text-muted-foreground text-xs" role="status">Focus the editor and press Meta/Ctrl+B: {sidebarOpen ? "the panel remains open." : "the panel remains closed."}</p>
    </div>
  );
}

function MailToolbarDemo() {
  const [value, setValue] = useState("Write a **focused reply** with a [link](https://example.com).");
  return <div className="mx-auto min-h-[280px] max-w-3xl bg-muted/20 p-6"><MarkdownEditor ariaLabel="Mail reply" onChange={setValue} toolbarPreset="mail" value={value} /></div>;
}

const meta = {
  title: "Product/Markdown editor",
  component: MarkdownEditor,
  // The editor's required props; every scenario below renders its own state, so these only fill the props table.
  args: { value: "", onChange: fn() },
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof MarkdownEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReplyComposer: Story = {
  render: () => <MarkdownEditorDemo />,
};

export const MailToolbar: Story = {
  render: () => <MailToolbarDemo />,
  parameters: {
    docs: {
      description: {
        story: "The composer preset keeps only mail-safe formatting: quote, emphasis, links, lists and history.",
      },
    },
  },
};

export const EditorOwnsModB: Story = {
  render: () => <ShortcutOwnershipDemo />,
  parameters: {
    docs: {
      description: {
        story: "The shared hotkey registry ignores typing targets, so shell Meta/Ctrl+B cannot steal the editor's bold shortcut.",
      },
    },
  },
};
