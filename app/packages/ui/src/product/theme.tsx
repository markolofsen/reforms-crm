"use client";

import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "../cn";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { ActionButton } from "./action-button";

/**
 * The one way the product themes (`design-system-and-tokens.md` rule 10). `next-themes` (the library `@djangocfg/ui-core/theme`
 * wraps, admitted on its own: ui-core's theme brings Radix and its own tokens) sets the `.dark` class with its own blocking
 * script, so a cold load in any saved choice paints the right theme. It owns its one storage key, `hub-theme`.
 */
export const THEME_STORAGE_KEY = "hub-theme";
export const THEMES = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof THEMES)[number];
const LABEL: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "System" };
const ICON: Record<ThemeChoice, LucideIcon> = { light: SunIcon, dark: MoonIcon, system: MonitorIcon };

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" disableTransitionOnChange enableSystem storageKey={THEME_STORAGE_KEY}>
      {children}
    </NextThemes>
  );
}

/** The theme drawn now (`light` or `dark`; undefined until mounted), for code that paints colours itself (the terminal). */
export const useResolvedTheme = (): string | undefined => useTheme().resolvedTheme;

const noop = () => () => {};
/** False on the server and in the first render, true after mount: the choice is a stored value (`state-and-data.md` rule 11). */
const useMounted = (): boolean => useSyncExternalStore(noop, () => true, () => false);
const choiceOf = (v: string | undefined): ThemeChoice => THEMES.find((t) => t === v) ?? "system";

/** Light / Dark / System as one segmented control (the open sidebar's footer). Renders an empty box of the same size until mounted. */
export function ThemeSegmented({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const value = choiceOf(theme);
  return (
    <SegmentedControl aria-label="Theme" className={cn("w-full", className)} role="radiogroup" size="sm">
      {THEMES.map((t) => {
        const Icon = ICON[t];
        const on = mounted && value === t;
        return (
          <SegmentedControlItem aria-checked={on} className="flex-1 text-muted-foreground" data-checked={on ? "" : undefined} disabled={!mounted} key={t} onClick={() => setTheme(t)} role="radio">
            <Icon aria-hidden="true" />
            {LABEL[t]}
          </SegmentedControlItem>
        );
      })}
    </SegmentedControl>
  );
}

/** One icon button that steps Light, Dark, System (the collapsed rail and the phone). */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const value = choiceOf(theme);
  const next = THEMES[(THEMES.indexOf(value) + 1) % THEMES.length] ?? "system";
  const Icon = ICON[mounted ? value : "system"];
  return (
    <ActionButton aria-label={mounted ? `Theme: ${LABEL[value]}. Switch to ${LABEL[next]}` : "Theme"} className={className} disabled={!mounted} icon onClick={() => setTheme(next)} size="s" variant="quiet">
      <Icon aria-hidden="true" />
    </ActionButton>
  );
}
