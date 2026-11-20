"use client";

import { useCallback } from "react";
import { AGENT_VIEWS, DEFAULT_DRAFT_VIEW, DRAFT_VIEWS, KNOWLEDGE_VIEWS, oneOf, ACTIVITY_VIEWS } from "@/routes/search";
import { formatDest, paths, type Dest } from "@/routes/paths";
import type { Resolved } from "@/routes/resolve";
import { useRoute } from "./use-route";

export type SearchKey = "filter" | "client" | "q";

/** The value of one search key on the current route (the default when the route does not carry it). */
export function searchValue(r: Resolved, key: "filter"): string;
export function searchValue(r: Resolved, key: "client"): number | null;
export function searchValue(r: Resolved, key: "q"): string;
export function searchValue(r: Resolved, key: SearchKey): string | number | null {
  if (key === "client") return r.route === "log.list" ? r.search.client : null;
  if (key === "q") return r.route === "drafts.list" || r.route === "drafts.item" || r.route === "knowledge.page" ? r.search.q : "";
  switch (r.route) {
    case "drafts.list":
    case "drafts.item":
    case "log.list":
    case "knowledge.page":
    case "settings.agent":
      return r.search.filter;
    default:
      return "all";
  }
}

/** The destination that sets one search key on the current route and keeps the rest. Null when the route has no such key. */
export function withSearch(r: Resolved, key: "filter", value: string): Dest | null;
export function withSearch(r: Resolved, key: "client", value: number | null): Dest | null;
export function withSearch(r: Resolved, key: "q", value: string): Dest | null;
export function withSearch(r: Resolved, key: SearchKey, value: string | number | null): Dest | null {
  if (key === "client") return r.route === "log.list" && typeof value !== "string" ? paths.log.list({ filter: r.search.filter, client: value }) : null;
  const v = String(value);
  if (key === "q") {
    if (r.route === "drafts.list") return paths.drafts.list({ filter: r.search.filter, q: v, batch: r.search.batch });
    if (r.route === "knowledge.page") return paths.knowledge.page({ filter: r.search.filter, q: v });
    return r.route === "drafts.item" ? paths.drafts.item(r.params.id, { filter: r.search.filter, q: v, batch: r.search.batch }) : null;
  }
  switch (r.route) {
    case "drafts.list":
      return paths.drafts.list({ filter: oneOf(DRAFT_VIEWS, v, DEFAULT_DRAFT_VIEW), q: r.search.q, batch: r.search.batch });
    case "drafts.item":
      return paths.drafts.item(r.params.id, { filter: oneOf(DRAFT_VIEWS, v, DEFAULT_DRAFT_VIEW), q: r.search.q, batch: r.search.batch });
    case "log.list":
      // Sends is the project's send history: switching to it leaves the one-client narrowing behind.
      return paths.log.list({ filter: oneOf(ACTIVITY_VIEWS, v, "all"), client: v === "sends" ? null : r.search.client });
    case "knowledge.page":
      return paths.knowledge.page({ filter: oneOf(KNOWLEDGE_VIEWS, v, "all"), q: r.search.q });
    case "settings.agent":
      return paths.settings.agent({ filter: oneOf(AGENT_VIEWS, v, "attention") });
    default:
      return null;
  }
}

/**
 * One search key as state. Setting it REPLACES the history entry (a filter is not a page, Back must not step through
 * every chip); the default value drops the key from the address. A subject (`/drafts/42`) is a path and PUSHES: use `useGo`.
 * This is the one hook that writes the query string in place.
 */
export function useSearchState(key: "filter"): [string, (value: string) => void];
export function useSearchState(key: "client"): [number | null, (value: number | null) => void];
export function useSearchState(key: "q"): [string, (value: string) => void];
export function useSearchState(key: SearchKey): [string | number | null, (value: never) => void] {
  const route = useRoute();
  const set = useCallback(
    (value: string | number | null) => {
      const d = key === "client" ? (typeof value === "string" ? null : withSearch(route, "client", value)) : key === "q" ? withSearch(route, "q", String(value)) : withSearch(route, "filter", String(value));
      // In place and shallow (no server round trip, P32 N0): Next's router follows `replaceState`, so the address and
      // `useSearchParams` change together and no history entry is added.
      if (d) window.history.replaceState(null, "", formatDest(d, { project: route.project, multi: route.inPath }));
    },
    [route, key],
  );
  return [key === "client" ? searchValue(route, "client") : key === "q" ? searchValue(route, "q") : searchValue(route, "filter"), set];
}
