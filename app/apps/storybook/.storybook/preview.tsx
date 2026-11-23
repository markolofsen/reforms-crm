import type { Preview } from "@storybook/react-vite";
import { UiProviders } from "@hub/ui/providers";
import { ThemeProvider } from "@hub/ui/product/theme";
import { ToastProvider } from "@hub/ui/toast";
import "../src/index.css";

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Preview theme",
      defaultValue: "light",
      toolbar: {
        icon: "paintbrush",
        items: ["light", "dark"],
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === "dark" ? "dark" : "light";
      return (
        <ThemeProvider forcedTheme={theme}>
          <UiProviders>
            <ToastProvider>
              <div className="min-h-svh bg-background text-foreground">
                <Story />
              </div>
            </ToastProvider>
          </UiProviders>
        </ThemeProvider>
      );
    },
  ],
  parameters: {
    a11y: {
      test: "error",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
