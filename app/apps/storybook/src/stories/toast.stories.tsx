import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionButton } from "@hub/ui/product/action-button";
import { toastManager } from "@hub/ui/toast";

function ToastDemo() {
  return (
    <div className="flex max-w-md flex-col gap-3 border bg-background p-6">
      <div>
        <h2 className="font-semibold text-lg">Feedback messages</h2>
        <p className="text-muted-foreground text-sm">Undo and error feedback stays outside the conversation scroll surface.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <ActionButton onClick={() => toastManager.add({ title: "Draft saved", description: "It remains unsent.", type: "success" })} variant="primary">Show success</ActionButton>
        <ActionButton onClick={() => toastManager.add({ title: "Could not save", description: "The text is still available in the editor.", type: "error" })} variant="secondary">Show error</ActionButton>
      </div>
    </div>
  );
}

const meta = {
  title: "Foundations/Toast",
  component: ToastDemo,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof ToastDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Feedback: Story = {};
