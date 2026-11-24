"use client";

import { Switch } from "@hub/ui/switch";
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
    <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-0" htmlFor="sound-switch">
      <Switch checked={!muted} id="sound-switch" onCheckedChange={(on) => save("sound", on ? "on" : "off")} />
      Agent sounds
    </label>
  );
}
