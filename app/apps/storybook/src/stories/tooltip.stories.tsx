import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionButton } from "@hub/ui/product/action-button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@hub/ui/tooltip";

function TooltipShowcase() {
  return (
    <div className="flex min-h-[320px] max-w-xl flex-col gap-8 border bg-background p-8">
      <div className="flex flex-wrap items-center gap-3">
        <Tooltip>
          <TooltipTrigger aria-label="Open the full project name" render={<span className="max-w-48 truncate rounded-md border px-3 py-2 text-sm">A long project name that needs context</span>} />
          <TooltipPopup>Full project name: A long project name that needs context</TooltipPopup>
        </Tooltip>
        <ActionButton aria-label="Open keyboard help" size="s" tooltip={{ content: "Open keyboard help", hotkey: "?" }} variant="secondary">Keyboard help</ActionButton>
        <ActionButton disabled aria-label="Unavailable action" size="s" tooltip="This action is unavailable" variant="secondary">Unavailable</ActionButton>
      </div>
      <p className="max-w-md text-muted-foreground text-sm">Truncated context uses the shared provider; action hints can add the same keyboard vocabulary without a native title.</p>
    </div>
  );
}

const meta = {
  title: "Foundations/Tooltip",
  component: TooltipShowcase,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof TooltipShowcase>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SharedProvider: Story = {
  render: () => <TooltipShowcase />,
};
