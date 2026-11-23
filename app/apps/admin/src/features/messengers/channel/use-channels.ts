"use client";

import type { MessengerChannelFilter } from "@hub/contract/messenger-panel";
import { useRoute } from "@/hooks/use-route";
import { useMessengerChats, useTelegramUser, useWhatsApp } from "@/lib/data/messengers";
import { dest, type Dest } from "@/routes/paths";
import { CHANNEL_FILTER_LABEL } from "../labels";
import { channelOptions } from "../unlinked/chats-model";

/** One channel under Messengers in the sidebar (P125 L5): its words, its address, its "client wrote" count, and whether it is on screen. */
export type ChannelItem = { id: Exclude<MessengerChannelFilter, "all">; title: string; to: Dest; count: number; active: boolean };

/** The Needs you count of one channel, read with the list's own key (Needs you, any link, no search), so an open list shares the request. */
function useNeedsYou(project: string | null, channel: Exclude<MessengerChannelFilter, "all">, on: boolean): number {
  const q = useMessengerChats(project, { filter: "needs_you", link: "any", channel, q: "" }, { enabled: on });
  return q.data?.counts.needs_you ?? 0;
}

/**
 * The sidebar children of Messengers (P125 L5, verdicts 12 and 14): Telegram and WhatsApp, each with its Needs you count, the parent
 * item itself being All. A channel whose account is not running is left out, and with fewer than two channels there is no
 * submenu at all (the same rule as the list's old channel control, `channelOptions`). The address keeps `?channel=`.
 */
export function useMessengerChannels(project: string | null): ChannelItem[] {
  const route = useRoute();
  const tg = useTelegramUser();
  const wa = useWhatsApp();
  const telegram = tg.data?.accounts.some((a) => a.state === "running") ?? false;
  const whatsapp = wa.data?.accounts.some((a) => a.state === "running") ?? false;
  const on = channelOptions({ telegram, whatsapp }).length > 0;
  const counts = { telegram: useNeedsYou(project, "telegram", on), whatsapp: useNeedsYou(project, "whatsapp", on) };
  if (!on) return [];
  const search = route.route === "messengers.page" || route.route === "messengers.conversation" ? route.search : null;
  // A channel keeps the view and link state on screen (Needs you, Linked, ...): the sidebar says where, the header which subset (verdict 13).
  return (["telegram", "whatsapp"] as const).map((c) => ({ id: c, title: CHANNEL_FILTER_LABEL[c], to: dest("messengers.page", { filter: search?.filter ?? "needs_you", link: search?.link ?? "any", channel: c }), count: counts[c], active: search?.channel === c }));
}
