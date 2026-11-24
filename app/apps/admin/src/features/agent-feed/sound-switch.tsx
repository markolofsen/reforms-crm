"use client";

import { SettingSwitch } from "@hub/ui/product/field";
import { save, useStored } from "@/lib/storage";
import { useFeed } from "./use-agent-feed";

/**
 * The agent sounds' one switch (P59 verdict 8a), in the footer's "⋯" popover beside the theme (P134 verdict 11): a setting,
 * remembered per browser (`lib/storage.ts` key `sound`). The sound is on until he mutes it. Muted, the strip's dot still changes.
 * Nothing without a project's feed.
 */
export function SoundSwitch() {
  const feed = useFeed();
  const muted = useStored("sound") === "off";
  if (!feed?.project) return null;
  return (
    <span className="flex items-center gap-2 text-sm">
      <SettingSwitch checked={!muted} id="sound-switch" labelledBy="sound-switch-label" onChange={(on) => save("sound", on ? "on" : "off")} pending={false} />
      <span id="sound-switch-label">Agent sounds</span>
    </span>
  );
}
