import type { MessengerChannelDto, MessengerChannelFilter } from "@hub/contract/messenger-panel";
import { cn } from "@hub/ui/cn";
import { TelegramIcon, WhatsAppIcon } from "@hub/ui/product/channel-icons";
import { CHANNEL_LABEL } from "../labels";

/**
 * The channel's mark (P102 S1): Telegram or WhatsApp as a theme-following icon (`currentColor`, never the brand colour), with the
 * channel's name for a screen reader, or beside it when `word` is set. The Telegram bot's chats are Telegram's.
 */
export function ChannelIcon({ channel, word = false, decorative = false, className }: { channel: MessengerChannelDto | Exclude<MessengerChannelFilter, "all">; word?: boolean; /** The name is said next to it already: no second one for a screen reader. */ decorative?: boolean; className?: string }) {
  const whatsapp = channel === "whatsapp";
  const Icon = whatsapp ? WhatsAppIcon : TelegramIcon;
  const label = channel === "telegram" ? "Telegram" : CHANNEL_LABEL[channel];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-muted-foreground", className)} data-channel-icon={whatsapp ? "whatsapp" : "telegram"}>
      <Icon aria-hidden="true" className="size-4" />
      {!decorative && <span className={word ? "text-xs" : "sr-only"}>{label}</span>}
    </span>
  );
}
