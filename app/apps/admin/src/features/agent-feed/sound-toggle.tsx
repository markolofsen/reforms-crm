"use client";

import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { ActionButton } from "@hub/ui/product/action-button";
import { save, useStored } from "@/lib/storage";
import { useFeed } from "./use-agent-feed";

/**
 * The agent sounds' one switch (P59 verdict 8a), beside the theme in the sidebar's footer: a setting, remembered per
 * browser (`lib/storage.ts` key `sound`). The sound is on until he mutes it. Muted, the strip's dot still changes.
 */
export function SoundToggle({ className }: { className?: string }) {
  const feed = useFeed();
  const muted = useStored("sound") === "off";
  if (!feed?.project) return null;
  return (
    <ActionButton aria-label="Mute the agent sounds" aria-pressed={muted} className={className} icon onClick={() => save("sound", muted ? "on" : "off")} size="s" title={muted ? "Agent sounds are muted" : "Mute the agent sounds"} variant="quiet">
      {muted ? <VolumeXIcon aria-hidden="true" /> : <Volume2Icon aria-hidden="true" />}
    </ActionButton>
  );
}
