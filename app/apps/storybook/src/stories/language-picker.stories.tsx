import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { LanguagePicker } from "@hub/ui/product/language-picker";

function LanguagePickerDemo() {
  const [language, setLanguage] = useState<string | null>(null);
  return (
    <div className="flex min-h-[360px] items-start justify-center bg-muted/20 p-8">
      <div className="flex w-full max-w-sm flex-col gap-2">
        <label className="font-medium text-sm" htmlFor="reply-language">Reply language</label>
        <LanguagePicker ariaLabel="Reply language" id="reply-language" includeClientDefault onChange={setLanguage} value={language} />
        <p className="text-muted-foreground text-xs">{language ? `Selected: ${language}` : "Defaults to the client’s language."}</p>
      </div>
    </div>
  );
}

const meta = {
  title: "Product/Language picker",
  component: LanguagePicker,
  // The picker's required props; the scenario renders its own state, so these only fill the props table.
  args: { ariaLabel: "Reply language", value: null, onChange: fn() },
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof LanguagePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReplyLanguage: Story = {
  render: () => <LanguagePickerDemo />,
};
