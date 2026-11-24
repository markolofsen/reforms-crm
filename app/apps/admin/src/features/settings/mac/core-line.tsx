"use client";

import { useCore } from "@/lib/data/instance";
import { AppLink } from "@/components/app-link";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@hub/ui/tooltip";
import { dest } from "@/routes/paths";
import { coreLine, coreLineDetail } from "./core-labels";

/**
 * The core version in the sidebar's footer (P68, P134 verdict 10): one muted line on every page, an `AppLink` to Settings ▸ This Mac where the detail
 * and the update command are (P70). Nothing while it loads or when the server does not answer; hidden in the icon rail. Its name is
 * its visible text (WCAG 2.5.3); the reason is the tooltip and the page it opens.
 */
export function CoreLine() {
  const q = useCore();
  if (!q.data) return null;
  const l = coreLine(q.data);
  return (
    <Tooltip>
      <TooltipTrigger render={
        <AppLink className="gap-2 px-2 text-xs group-data-[collapsible=icon]:hidden" data-testid="core-line" to={dest("settings.mac")}>
          <span className="min-w-0 truncate">
            {l.text}
            {l.note && <span className={l.dot ? "text-foreground" : undefined}> · {l.note}</span>}
          </span>
          {l.dot && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" data-testid="core-dot" />}
        </AppLink>
      } />
      <TooltipPopup>{coreLineDetail(q.data)}</TooltipPopup>
    </Tooltip>
  );
}
