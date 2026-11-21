import type { MessengerChannelFilter } from "@hub/contract/messenger-panel";
import { RadioGroupPrimitive, RadioPrimitive } from "@hub/ui/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@hub/ui/segmented-control";
import { MESSENGER_CHANNEL_FILTERS, oneOf } from "@/routes/search";
import { CHANNEL_FILTER_LABEL } from "../labels";
import { ChannelIcon } from "./channel-icon";

/**
 * The channel as a filter of Chats (P84c, `?channel=`): All · Telegram · WhatsApp, one value always chosen, so the coss segmented
 * control over a radio group. Only the connected accounts' options are given; with fewer than two the caller shows none. No count
 * on it: the View menu carries the numbers (`admin-principles.md` rule 10). 44 px high below 1024 px (`control-m`); the labels (icon and word for a channel, P102) in the foreground colour, since the stock muted one fails the contrast check (axe, P84c).
 */
export function ChannelFilter({ value, options, onChange }: { value: MessengerChannelFilter; options: readonly MessengerChannelFilter[]; onChange: (v: MessengerChannelFilter) => void }) {
  return (
    <SegmentedControl
      aria-label="Channel"
      render={<RadioGroupPrimitive onValueChange={(v) => onChange(oneOf(MESSENGER_CHANNEL_FILTERS, String(v), "all"))} value={value} />}
    >
      {options.map((o) => (
        <SegmentedControlItem className="control-m text-foreground" key={o} render={<RadioPrimitive.Root value={o} />}>
          {o === "all" ? CHANNEL_FILTER_LABEL[o] : <ChannelIcon className="text-foreground" channel={o} word />}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
