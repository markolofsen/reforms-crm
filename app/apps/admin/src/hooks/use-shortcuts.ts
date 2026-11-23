"use client";

import { load, save, useStored } from "@/lib/storage";

/** The remembered off switch of every page shortcut ("Keyboard shortcuts" in the `?` popover); the dispatcher, its typing and modifier guards and the chord window are `@hub/ui/use-hotkey`. */
export function useShortcutsSwitch(): [boolean, (on: boolean) => void] {
  const on = useStored("shortcuts") !== "off";
  return [on, (next) => save("shortcuts", next ? "on" : "off")];
}

export const shortcutsOn = (): boolean => load("shortcuts") !== "off";
