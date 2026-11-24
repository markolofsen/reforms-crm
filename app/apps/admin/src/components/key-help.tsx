import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Kbd } from "@hub/ui/kbd";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "@hub/ui/popover";
import { Switch } from "@hub/ui/switch";
import { liveKeys } from "@hub/ui/use-hotkey";

const NAME = "Theme, sounds and shortcuts";

/**
 * The footer's one "⋯" popover (P134 verdict 11): this browser's own settings first (`controls`: the theme, the agent sounds),
 * then every shortcut live on this screen (the keys register themselves, so the list is never a second copy) and the switch that
 * turns shortcuts off. One instance, in the sidebar footer; the `?` key opens it from anywhere.
 */
export function KeyHelp({ open, onOpenChange, enabled, onEnabled, controls }: { open: boolean; onOpenChange: (open: boolean) => void; enabled: boolean; onEnabled: (on: boolean) => void; controls?: ReactNode }) {
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger render={<ActionButton aria-label={NAME} icon size="s" tooltip={NAME} variant="quiet" />}>
        <EllipsisIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-80 max-w-[calc(100vw-2rem)]" side="top">
        <div className="flex min-w-0 flex-col gap-3">
          {controls}
          <PopoverTitle className="text-base">Keyboard shortcuts</PopoverTitle>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-sm">
            {liveKeys().map(([k, what]) => (
              <div className="contents" key={`${k}:${what}`}>
                <dt>
                  <Kbd>{k}</Kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-0" htmlFor="shortcuts-switch">
            <Switch checked={enabled} id="shortcuts-switch" onCheckedChange={onEnabled} />
            Shortcuts
          </label>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
