import { ChevronDownIcon } from "lucide-react";
import type { ActivityDto } from "@hub/contract/activity";
import { ActionButton } from "@hub/ui/product/action-button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@hub/ui/menu";
import type { ActivityView } from "@/routes/search";
import { VIEW_LABELS, VIEW_ORDER } from "./labels";

/** The View menu of Activity: which sessions to show, each with its count from the server (`counts`), then Sends with its own. */
export function FilterMenu({ value, counts, sends, onChange }: { value: ActivityView; counts: ActivityDto["counts"] | undefined; sends: number | undefined; onChange: (v: string) => void }) {
  const count = (f: ActivityView) => (f === "sends" ? sends : counts?.[f]) ?? "-";
  return (
    <Menu>
      <MenuTrigger render={<ActionButton size="m" variant="secondary" />}>
        <span className="sr-only">View: </span>
        {VIEW_LABELS[value]}
        <span className="font-normal tabular-nums">{count(value)}</span>
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup onValueChange={(v) => onChange(String(v))} value={value}>
          {VIEW_ORDER.map((f) => (
            <MenuRadioItem key={f} value={f}>
              {VIEW_LABELS[f]} <span className="ms-auto ps-3 text-muted-foreground tabular-nums">{count(f)}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
