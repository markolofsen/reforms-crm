"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { MessengerChatsQuery } from "@hub/contract/messenger-panel";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";

/**
 * P127 C2's data half (V3): Messengers' reads and writes (state rule 4b). The chats of a view, a link state, a channel and a
 * search, one key each (`keys.messengerChats`), so the sidebar's counts and an open list share a request.
 */

/** The server's linked chats under the view and link state (P123 U3b), with the View menu's counts. `keep` keeps the last list while typing. */
export const useMessengerChats = (project: string | null, query: MessengerChatsQuery, o: { keep?: boolean; enabled?: boolean } = {}) =>
  useQuery({
    queryKey: keys.messengerChats(project ?? "", query.filter, query.link, query.channel, query.q),
    queryFn: () => messengersApi.chats(project ?? "", query),
    enabled: project !== null && (o.enabled ?? true),
    ...(o.keep ? { placeholderData: keepPreviousData } : {}),
  });
