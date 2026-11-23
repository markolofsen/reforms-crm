"use client";

import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { ChatsView } from "./chats-view";

/**
 * Messengers (P71 M3, decision 0036 point 6): what the messengers owe, a review queue and not a chat client. One page (P125
 * L5): the channels are the sidebar's children, and the logins, the bot, each linked chat's rules and the send guards are
 * Settings ▸ Messengers. The address's project's: the linked chats and their drafts belong to a project.
 */
export function ChatsScreen() {
  const { project } = useProjectScope();
  const route = useRoute();
  if (route.route !== "messengers.page" && route.route !== "messengers.conversation") return null;
  return <ChatsView channel={route.search.channel} chatId={route.route === "messengers.conversation" ? route.params.id : null} filter={route.search.filter} link={route.search.link} project={project} />;
}
