"use client";

import { useQuery } from "@tanstack/react-query";
import { Link } from "@hub/ui/link";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { paths } from "@/routes/paths";
import { coreLine } from "./core-labels";

/**
 * The core version in the sidebar's footer (P68): one quiet line on every page, a link to `/health` where the detail is. Nothing
 * while it loads or when the server does not answer (the health page says why); hidden in the icon rail.
 */
export function CoreLine() {
  const q = useQuery({ queryKey: keys.core(), queryFn: metaApi.core, retry: false });
  if (!q.data) return null;
  const l = coreLine(q.data);
  return (
    <Link className="gap-2 px-2 text-xs group-data-[collapsible=icon]:hidden" data-testid="core-line" href={paths.health()} title={q.data.reason}>
      <span className="truncate">{l.text}</span>
      {l.note && <span className={l.dot ? "text-foreground" : undefined}>{l.note}</span>}
      {l.dot && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" data-testid="core-dot" />}
    </Link>
  );
}
