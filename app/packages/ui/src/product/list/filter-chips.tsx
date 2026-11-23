import { RadioGroupPrimitive, RadioPrimitive } from "../../ui/radio-group";
import { SegmentedControl, SegmentedControlItem } from "../../ui/segmented-control";

export type Chip<T extends string> = { value: T; label: string; count: number | undefined | null };

/**
 * One row of filter chips with counts. The chips share the row's width and use the small type, so five
 * chips with counts fit the 336px of a list column whole ("All" is never cut; `a-layout.spec.ts` measures it). If a
 * list ever holds more, the row scrolls inside its own strip and the page never scrolls sideways. `count: null` shows no count (a plain choice). Chips are 44px high below 1024px (touch).
 */
export function FilterChips<T extends string>({
  label,
  chips,
  value,
  onChange,
}: {
  label: string;
  chips: Chip<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="scroll-strip w-full">
      <SegmentedControl
        aria-label={label}
        render={<RadioGroupPrimitive onValueChange={(v) => { const hit = chips.find((c) => c.value === v); if (hit) onChange(hit.value); }} value={value} />}
        className="w-full"
        size="sm"
      >
        {chips.map((c) => (
          <SegmentedControlItem className="min-h-(--control-s) flex-1 px-1 text-muted-foreground text-xs sm:text-xs" key={c.value} render={<RadioPrimitive.Root value={c.value} />}>
            {c.label}
            {c.count !== null && <span className="font-normal tabular-nums">{c.count ?? "-"}</span>}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  );
}
