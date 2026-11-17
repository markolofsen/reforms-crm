import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ConnectionsDto } from "@hub/contract/connections";
import { connectionsApi } from "@/lib/api/connections";
import { sentence } from "@/lib/api/client";

export const CONNECTIONS_KEY = ["connections"] as const;

export const useConnections = () => useQuery({ queryKey: CONNECTIONS_KEY, queryFn: connectionsApi.list });

/**
 * One test at a time for the page. The reply is the one connection with its new check: it patches the cached list, and one sentence
 * reaches the live region (`status` for a result, `alert` for a failure). The sentence is the server's, which never carries a value.
 */
export function useTest() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<{ text: string; kind: "status" | "alert" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: connectionsApi.test,
    onSuccess: (row) => qc.setQueryData<ConnectionsDto>(CONNECTIONS_KEY, (old) => old && { ...old, connections: old.connections.map((c) => (c.id === row.id ? row : c)) }),
  });
  const test = useCallback(
    async (id: string, label: string) => {
      setBusy(id);
      setStatus({ text: `Testing ${label}...`, kind: "status" });
      try {
        const row = await mutation.mutateAsync(id);
        const c = row.check;
        const detail = "value" in c && c.value ? c.value.detail : "message" in c ? `${c.message} ${c.fix}` : "";
        setStatus({ text: `${label}: ${c.state === "error" ? "test failed. " : ""}${detail}`.trim(), kind: c.state === "error" ? "alert" : "status" });
      } catch (e) {
        setStatus({ text: `Could not test ${label}: ${sentence(e)}`, kind: "alert" });
      } finally {
        setBusy(null);
      }
    },
    [mutation],
  );
  return { status, busy, test };
}
