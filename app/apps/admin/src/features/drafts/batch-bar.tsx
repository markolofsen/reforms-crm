import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Menu, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@hub/ui/menu";
import { bulkApi } from "@/lib/api/bulk";
import { useGo } from "@/hooks/use-go";
import { paths } from "@/routes/paths";
import type { DraftView } from "@/routes/search";

const ALL = "all";

/**
 * One queue, a batch is a filter of it: this menu is the whole way to a batch ("All drafts" or one batch by name) and to the
 * builder ("New batch"). Choosing replaces the history entry, like any filter; the view the person was on stays.
 */
export function BatchBar({ project, batch, filter, name }: { project: string; batch: number | null; filter: DraftView; name: string | null }) {
  const go = useGo();
  const q = useQuery({ queryKey: ["batches", project], queryFn: () => bulkApi.list(project) });
  const batches = q.data?.batches ?? [];
  return (
    <div className="flex items-center gap-2 px-3 pt-3">
      <Menu>
        <MenuTrigger render={<ActionButton aria-label={`Show: ${name ?? "All drafts"}`} className="min-w-0 max-w-full" size="s" variant="secondary" />}>
          <span className="truncate">{name ?? "All drafts"}</span>
          <ChevronDownIcon aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuRadioGroup onValueChange={(v) => go(paths.drafts.list({ filter, batch: v === ALL ? null : Number(v) }), { replace: true })} value={batch === null ? ALL : String(batch)}>
            <MenuRadioItem value={ALL}>All drafts</MenuRadioItem>
            {batches.map((b) => (
              <MenuRadioItem key={b.id} value={String(b.id)}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{b.name}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {b.status === "queued" ? "Waiting for the agent" : `${b.counts.done + b.counts.skipped} of ${b.total} finished`}
                  </span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem onClick={() => go(paths.drafts.newBatch())}>New batch</MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}
