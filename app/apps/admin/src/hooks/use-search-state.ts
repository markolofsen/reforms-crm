"use client";

import { useCallback } from "react";
import { AGENT_VIEWS, DEFAULT_DRAFT_VIEW, DRAFT_VIEWS, KNOWLEDGE_VIEWS, MESSENGER_CHANNEL_FILTERS, MESSENGER_VIEWS, oneOf, ACTIVITY_VIEWS } from "@/routes/search";
import { formatDest, paths, type Dest } from "@/routes/paths";
import type { Resolved } from "@/routes/resolve";
import { useRoute } from "./use-route";

export type SearchKey = "filter" | "client" | "q" | "channel";

/** The value of one search key on the current route (the default when the route does not carry it). */
export function searchValue(r: Resolved, key: "filter"): string;
export function searchValue(r: Resolved, key: "client"): number | null;
export function searchValue(r: Resolved, key: "q"): string;
export function searchValue(r: Resolved, key: "channel"): string;
export function searchValue(r: Resolved, key: SearchKey): string | number | null {
  if (key === "client") return r.route === "log.list" ? r.search.client : null;
  if (key === "channel") return r.route === "messengers.page" ? r.search.channel : "all";
  if (key === "q") return r.route === "mail.list" || r.route === "mail.item" || r.route === "mail.inbound" || r.route === "knowledge.page" ? r.search.q : "";
  switch (r.route) {
    case "mail.list":
    case "mail.item":
    case "mail.inbound":
    case "log.list":
    case "knowledge.page":
    case "settings.agent":
    case "messengers.page":
      return r.search.filter;
    default:
      return "all";
  }
}

/** The destination that sets one search key on the current route and keeps the rest. Null when the route has no such key. */
export function withSearch(r: Resolved, key: "filter", value: string): Dest | null;
export function withSearch(r: Resolved, key: "client", value: number | null): Dest | null;
export function withSearch(r: Resolved, key: "q", value: string): Dest | null;
export function withSearch(r: Resolved, key: "channel", value: string): Dest | null;
export function withSearch(r: Resolved, key: SearchKey, value: string | number | null): Dest | null {
  if (key === "client") return r.route === "log.list" && typeof value !== "string" ? paths.log.list({ filter: r.search.filter, client: value }) : null;
  const v = String(value);
  // P84c: the Messengers panel's channel keeps its view, and its view keeps the channel.
  if (key === "channel") return r.route === "messengers.page" ? paths.messengers.chats({ filter: r.search.filter, channel: oneOf(MESSENGER_CHANNEL_FILTERS, v, "all") }) : null;
  if (key === "q") {
    if (r.route === "mail.list") return paths.mail.list({ filter: r.search.filter, q: v, batch: r.search.batch });
    if (r.route === "knowledge.page") return paths.knowledge.page({ filter: r.search.filter, q: v });
    if (r.route === "mail.inbound") return paths.mail.inbound(r.params.id, { filter: r.search.filter, q: v, batch: r.search.batch });
    return r.route === "mail.item" ? paths.mail.item(r.params.id, { filter: r.search.filter, q: v, batch: r.search.batch }) : null;
  }
  switch (r.route) {
    case "mail.list":
      return paths.mail.list({ filter: oneOf(DRAFT_VIEWS, v, DEFAULT_DRAFT_VIEW), q: r.search.q, batch: r.search.batch });
    case "mail.item":
      return paths.mail.item(r.params.id, { filter: oneOf(DRAFT_VIEWS, v, DEFAULT_DRAFT_VIEW), q: r.search.q, batch: r.search.batch });
    case "mail.inbound":
      // A view change leaves a client's message: the list of the new view opens its own first row.
      return paths.mail.list({ filter: oneOf(DRAFT_VIEWS, v, DEFAULT_DRAFT_VIEW), q: r.search.q, batch: r.search.batch });
    case "log.list":
      // Sends is the project's send history: switching to it leaves the one-client narrowing behind.
      return paths.log.list({ filter: oneOf(ACTIVITY_VIEWS, v, "all"), client: v === "sends" ? null : r.search.client });
    case "knowledge.page":
      return paths.knowledge.page({ filter: oneOf(KNOWLEDGE_VIEWS, v, "all"), q: r.search.q });
    case "settings.agent":
      return paths.settings.agent({ filter: oneOf(AGENT_VIEWS, v, "attention") });
    case "messengers.page":
      return paths.messengers.chats({ filter: oneOf(MESSENGER_VIEWS, v, "todo"), channel: r.search.channel });
    default:
      return null;
  }
}

/**
 * One search key as state. Setting it REPLACES the history entry (a filter is not a page, Back must not step through
 * every chip); the default value drops the key from the address. A subject (`/mail/42`) is a path and PUSHES: use `useGo`.
 * This is the one hook that writes the query string in place.
 */
export function useSearchState(key: "filter"): [string, (value: string) => void];
export function useSearchState(key: "client"): [number | null, (value: number | null) => void];
export function useSearchState(key: "q"): [string, (value: string) => void];
export function useSearchState(key: "channel"): [string, (value: string) => void];
export function useSearchState(key: SearchKey): [string | number | null, (value: never) => void] {
  const route = useRoute();
  const set = useCallback(
    (value: string | number | null) => {
      const d =
        key === "client"
          ? typeof value === "string"
            ? null
            : withSearch(route, "client", value)
          : key === "q"
            ? withSearch(route, "q", String(value))
            : key === "channel"
              ? withSearch(route, "channel", String(value))
              : withSearch(route, "filter", String(value));
      // In place and shallow (no server round trip, P32 N0): Next's router follows `replaceState`, so the address and
      // `useSearchParams` change together and no history entry is added.
      if (d) window.history.replaceState(null, "", formatDest(d, { project: route.project, multi: route.inPath }));
    },
    [route, key],
  );
  return [key === "client" ? searchValue(route, "client") : key === "q" ? searchValue(route, "q") : key === "channel" ? searchValue(route, "channel") : searchValue(route, "filter"), set];
}
