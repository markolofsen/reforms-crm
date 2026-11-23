"use client";

import type { ReactElement, ReactNode } from "react";
import { HotkeyProvider } from "./use-hotkey";
import { TooltipProvider } from "./ui/tooltip";

export function UiProviders({ children }: { children: ReactNode }): ReactElement {
  return <HotkeyProvider><TooltipProvider>{children}</TooltipProvider></HotkeyProvider>;
}
