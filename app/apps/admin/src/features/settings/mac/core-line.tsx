"use client";

import { useQuery } from "@tanstack/react-query";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { AppLink } from "@/components/app-link";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@hub/ui/tooltip";
import { dest } from "@/routes/paths";
import { coreLine } from "./core-labels";

/**
 * The core version in the sidebar's footer (P68): one quiet line on every page, an `AppLink` to Settings ▸ This Mac where the detail
 * and the update command are (P70). Nothing while it loads or when the server does not answer; hidden in the icon rail. Its name is
 * its visible text (WCAG 2.5.3); the reason is the tooltip and the page it opens.
 */
export function CoreLine() {
  const q = useQuery({ queryKey: keys.core(), queryFn: metaApi.core, retry: false });
  if (!q.data) return null;
  const l = coreLine(q.data);
  return (
    <Tooltip>
      <TooltipTrigger render={
        <AppLink className="gap-2 px-2 text-xs group-data-[collapsible=icon]:hidden" data-testid="core-line" to={dest("settings.mac")}>
          <span className="truncate">{l.text}</span>
          {l.note && <span className={l.dot ? "text-foreground" : undefined}>{l.note}</span>}
          {l.dot && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" data-testid="core-dot" />}
        </AppLink>
      } />
      <TooltipPopup>{q.data.reason}</TooltipPopup>
    </Tooltip>
  );
}
