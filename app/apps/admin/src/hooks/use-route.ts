"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { resolveRoute, type Resolved } from "@/routes/resolve";
import { addressOf, type RouteId } from "@/routes/table";

/**
 * The path of the address, as the address bar shows it. One of the places the framework's navigation state is read
 * (`next/navigation` stays in `hooks/` and `app/`). A bare scoped address is rendered from `/_/…` (P127 A2, `src/proxy.ts`), and
 * the server may report that inside form, so it is read back as the address here, once, and no screen ever sees `_`.
 */
export const usePath = (): string => addressOf(usePathname());

/** The query of the address as it is written (`filter=all&link=linked`), for an effect that must follow every replace of it. */
export const useQueryString = (): string => useSearchParams().toString();

/**
 * The address as a typed route. The one place the router state is turned into a value. With a route id (P127 A1): that route,
 * narrowed, or null on any other address, so a screen reads its params and search without its own `route.route !== …` check.
 */
export function useRoute(): Resolved;
export function useRoute<K extends RouteId>(id: K): Extract<Resolved, { route: K }> | null;
export function useRoute(id?: RouteId): Resolved | null {
  const path = usePath();
  const search = useSearchParams().toString();
  const r = useMemo(() => resolveRoute(path, search), [path, search]);
  return id === undefined || r.route === id ? r : null;
}

