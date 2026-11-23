"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ThemeProvider } from "@hub/ui/product/theme";
import { UiProviders } from "@hub/ui/providers";
import { ToastProvider } from "@hub/ui/toast";
import { queryClient } from "@/lib/api/client";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <UiProviders>
          <ToastProvider>{children}</ToastProvider>
        </UiProviders>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
