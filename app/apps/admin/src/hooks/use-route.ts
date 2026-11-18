"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { resolveRoute, type Resolved } from "@/routes/resolve";

/** The path of the address. One of the places the framework's navigation state is read (`next/navigation` stays in `hooks/` and `app/`). */
export const usePath = (): string => usePathname();

/** The address as a typed route. The one place the router state is turned into a value. */
export function useRoute(): Resolved {
  const path = usePath();
  const search = useSearchParams().toString();
  return useMemo(() => resolveRoute(path, search), [path, search]);
}
