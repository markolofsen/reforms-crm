"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { parseClientKey } from "@hub/contract/client-key";
import { useGo } from "@/hooks/use-go";
import { reviewApi } from "@/lib/api/review";
import { keys } from "@/lib/cache/keys";
import { dest } from "@/routes/paths";
import type { SearchFor } from "@/routes/table";

/** What the address's client key names: the row id (null while an email key is asked), or `missing` when nobody has that key. */
export type KeyedClient = { id: number | null; missing: boolean };

/**
 * P103: the open conversation's client from the address key. An `id-<n>` key names its row at once; an email key waits for the
 * server. Either way the server's canonical key replaces the address when it differs (`id-7` → `ana@example.com`, a capital
 * letter → lower case), so a click from a row that knows only the id still ends on the email, in one history entry.
 */
export function useClientKey(project: string, key: string | null, search: SearchFor<"mail.conversation">): KeyedClient {
  const go = useGo();
  const ref = key === null ? null : parseClientKey(key);
  const q = useQuery({ queryKey: keys.clientKey(project, key ?? ""), queryFn: () => reviewApi.clientByKey(project, key ?? ""), enabled: key !== null && ref !== null, retry: false });
  const canonical = q.data?.key ?? null;
  useEffect(() => {
    if (key !== null && canonical !== null && canonical !== key) go(dest("mail.conversation", { key: canonical }, search), { replace: true });
  }, [canonical, go, key, search]);
  if (key === null || ref === null) return { id: null, missing: key !== null };
  if ("id" in ref) return { id: ref.id, missing: q.isError };
  return { id: q.data?.id ?? null, missing: q.isError };
}
