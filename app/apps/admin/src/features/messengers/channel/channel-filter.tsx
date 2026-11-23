import type { MessengerChannelFilter } from "@hub/contract/messenger-panel";
import { ListFilterMenu } from "@hub/ui/product/list-toolbar";
import { MESSENGER_CHANNEL_FILTERS, oneOf } from "@/routes/search";
import { CHANNEL_FILTER_LABEL } from "../labels";
import { ChannelIcon } from "./channel-icon";

/**
 * The channel as a filter of Chats (P84c, `?channel=`): All · Telegram · WhatsApp, one value always chosen in a compact menu.
 * Only the connected accounts' options are given; with fewer than two the caller shows none. No count on it: the View menu carries
 * the numbers (`admin-principles.md` rule 10). The selected channel keeps its icon and readable label in the trigger (P102).
 */
export function ChannelFilter({ value, options, onChange }: { value: MessengerChannelFilter; options: readonly MessengerChannelFilter[]; onChange: (v: MessengerChannelFilter) => void }) {
  return <ListFilterMenu name="Channel" onChange={(next) => onChange(oneOf(MESSENGER_CHANNEL_FILTERS, next, "all"))} options={options.map((o) => ({ value: o, label: o === "all" ? CHANNEL_FILTER_LABEL[o] : <ChannelIcon channel={o} word />, triggerLabel: o === "all" ? CHANNEL_FILTER_LABEL[o] : <ChannelIcon channel={o} word /> }))} tooltip="Filter by channel" value={value} />;
}
