import { ChevronDownIcon } from "lucide-react";
import type { ActivityDto } from "@hub/contract/activity";
import { ActionButton } from "@hub/ui/product/action-button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@hub/ui/menu";
import type { RunFilter } from "@/routes/search";
import { RUN_FILTER_LABELS, RUN_FILTER_ORDER } from "./labels";

/** The View menu of Activity: which sessions to show, each with its count from the server (`counts`). */
export function FilterMenu({ value, counts, onChange }: { value: RunFilter; counts: ActivityDto["counts"] | undefined; onChange: (v: string) => void }) {
  const count = (f: RunFilter) => counts?.[f] ?? "-";
  return (
    <Menu>
      <MenuTrigger render={<ActionButton size="m" variant="secondary" />}>
        <span className="sr-only">Show: </span>
        {RUN_FILTER_LABELS[value]}
        <span className="font-normal tabular-nums">{count(value)}</span>
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup onValueChange={(v) => onChange(String(v))} value={value}>
          {RUN_FILTER_ORDER.map((f) => (
            <MenuRadioItem key={f} value={f}>
              {RUN_FILTER_LABELS[f]} <span className="ms-auto ps-3 text-muted-foreground tabular-nums">{count(f)}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
