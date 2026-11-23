"use client";

import { useCallback } from "react";
import { formatDest } from "@/routes/paths";
import { searchDest } from "@/routes/resolve";
import { readSearch, type SearchOf, type SearchSpec } from "@/routes/search";
import { ROUTE_TABLE } from "@/routes/table";
import { useRoute } from "./use-route";

/** The current route's search holds every key of the spec (the route shares it, as Mail's three routes share `MAIL_SEARCH`). */
function carries<S extends SearchSpec>(spec: S, search: Readonly<Record<string, unknown>>): search is SearchOf<S> {
  return Object.keys(spec).every((k) => k in search);
}

/** Keys of the spec to set: a typed value, or a menu's text, which the spec reads (one outside its enum resets to the default). */
export type SearchPatch<S extends SearchSpec> = { [K in keyof S]?: SearchOf<S>[K] | string };

/**
 * A screen's search as state (P127 A1: one typed hook in place of a key per call): `[value, set]` for the spec of the screen's
 * route (`useSearch(MAIL_SEARCH)`). On a route that does not carry the spec the value is the spec's defaults and `set` does
 * nothing. `set(patch)` REPLACES the history entry (a filter is not a page, Back must not step through every chip); a default
 * value drops its key from the address. A subject (`/mail/c/42`) is a path and PUSHES: use `useGo`. This is the one hook that
 * writes the query string in place.
 */
export function useSearch<S extends SearchSpec>(spec: S): [SearchOf<S>, (patch: SearchPatch<S>) => void] {
  const route = useRoute();
  const own = route.route !== "notFound" && "search" in ROUTE_TABLE[route.route] && carries(spec, route.search) ? route.search : null;
  const set = useCallback(
    (patch: SearchPatch<S>) => {
      const entries: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(patch)) if (typeof v === "string" || typeof v === "number" || v === null) entries[k] = v;
      const d = searchDest(route, entries);
      // In place and shallow (no server round trip, P32 N0): Next's router follows `replaceState`, so the address and
      // `useSearchParams` change together and no history entry is added.
      if (d) window.history.replaceState(null, "", formatDest(d, { project: route.project, multi: route.inPath }));
    },
    [route],
  );
  return [own ?? readSearch(spec, {}), set];
}
