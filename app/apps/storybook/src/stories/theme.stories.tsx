import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionButton } from "@hub/ui/product/action-button";
import { ThemeSegmented, ThemeToggle } from "@hub/ui/product/theme";

function ThemeDemo() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 border bg-background p-6">
      <div>
        <h2 className="font-semibold text-lg">Theme controls</h2>
        <p className="text-muted-foreground text-sm">The same controls are used in the expanded sidebar, collapsed rail and phone bar.</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <ThemeSegmented className="max-w-56" />
        <ThemeToggle />
        <ActionButton variant="secondary">A themed action</ActionButton>
      </div>
    </div>
  );
}

const meta = {
  title: "Product/Theme",
  component: ThemeSegmented,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof ThemeSegmented>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SidebarAndRail: Story = {
  render: () => <ThemeDemo />,
  parameters: {
    docs: {
      description: {
        story: "The segmented and single-button theme controls share labels, tooltips and the responsive 44px target contract.",
      },
    },
  },
};
