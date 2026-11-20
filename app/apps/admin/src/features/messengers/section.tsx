"use client";

import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { ChatsView } from "./chats-view";
import { MessengerSettings } from "./settings/settings-view";

/**
 * Messengers (P71 M3, decision 0036 point 6): what the messengers owe, a review queue and not a chat client. Two pages under one
 * sub-nav (P75's strip, never sidebar children): Chats, the panel, and Settings, the logins, the bot, each linked chat's rules and
 * the send guards. The address's project's: the linked chats and their drafts belong to a project.
 */
export function ChatsScreen() {
  const { project } = useProjectScope();
  const route = useRoute();
  if (route.route !== "messengers.page") return null;
  return <ChatsView filter={route.search.filter} project={project} />;
}

/** Messengers ▸ Settings. */
export function MessengerSettingsScreen() {
  const { project } = useProjectScope();
  const route = useRoute();
  if (route.route !== "messengers.settings") return null;
  return <MessengerSettings project={project} />;
}
