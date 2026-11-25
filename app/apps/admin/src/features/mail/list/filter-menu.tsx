import { ListFilterIcon } from "lucide-react";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";

/** One filter of the list (Sequence steps, Not by email) or one brand, with its count. */
export type FilterOption = { value: string; label: string; count: number | undefined };
/** P134 verdict 4: the brands of the list on screen with their counts; the group shows only with two or more. */
export type BrandCount = { name: string; count: number };

const ALL_BRANDS = "";

type Props = {
  /** Filters of All (P99 verdict 3); one with nothing in it is left out unless it is on screen. */
  filters: readonly FilterOption[];
  /** The filter on screen, or null for a view of the sidebar. */
  filter: string | null;
  onFilter: (value: string | null) => void;
  brands: readonly BrandCount[];
  brand: string | null;
  onBrand: (brand: string | null) => void;
  /** What the menu narrows, for its name ("mail", "leads"). */
  what: string;
};

/**
 * The filter button beside the search (P134 verdicts 1 and 4): what the sidebar does not choose. The filters of All (Sequence steps,
 * Not by email) and, only when the list holds two or more brands, the brands with their counts (`?brand=`). Nothing to choose:
 * no button at all, so a single-brand project sees nothing new. A filter or a brand on screen marks the button as pressed.
 */
export function ListFilterButton({ filters, filter, onFilter, brands, brand, onBrand, what }: Props) {
  const shown = filters.filter((f) => f.value === filter || (f.count ?? 0) > 0);
  const brandsShown = brands.length >= 2 || brand !== null;
  if (shown.length === 0 && !brandsShown) return null;
  const active = filter !== null || brand !== null;
  const label = active ? `Filter ${what}: ${[filter && shown.find((f) => f.value === filter)?.label, brand].filter(Boolean).join(", ")}` : `Filter ${what}`;
  return (
    <Menu>
      <MenuTrigger render={<ActionButton aria-label={label} aria-pressed={active} icon size="s" tooltip={label} variant={active ? "primary" : "secondary"} />}>
        <ListFilterIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        {shown.length > 0 && (
          <MenuGroup>
            <MenuGroupLabel>Filters</MenuGroupLabel>
            <MenuRadioGroup onValueChange={(v) => onFilter(String(v) || null)} value={filter ?? ""}>
              {shown.map((f) => (
                <MenuRadioItem closeOnClick key={f.value} value={f.value}>
                  {f.label}
                  {f.count !== undefined && <span className="ms-auto ps-3 text-muted-foreground tabular-nums">{f.count}</span>}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
            {filter !== null && <MenuItem onClick={() => onFilter(null)}>Clear filter</MenuItem>}
          </MenuGroup>
        )}
        {shown.length > 0 && brandsShown && <MenuSeparator />}
        {brandsShown && (
          <MenuGroup>
            <MenuGroupLabel>Brand</MenuGroupLabel>
            <MenuRadioGroup onValueChange={(v) => onBrand(String(v) || null)} value={brand ?? ALL_BRANDS}>
              <MenuRadioItem closeOnClick value={ALL_BRANDS}>
                All brands
              </MenuRadioItem>
              {brands.map((b) => (
                <MenuRadioItem closeOnClick key={b.name} value={b.name}>
                  {b.name}
                  <span className="ms-auto ps-3 text-muted-foreground tabular-nums">{b.count}</span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        )}
      </MenuPopup>
    </Menu>
  );
}
