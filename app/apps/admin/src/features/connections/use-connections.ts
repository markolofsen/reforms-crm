import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ConnectionDto, ConnectionsDto } from "@hub/contract/connections";
import type { SetSecretBody } from "@hub/contract/requests";
import { connectionsApi } from "@/lib/api/connections";
import { sentence } from "@/lib/api/client";
import { keys } from "@/lib/cache/keys";

export const CONNECTIONS_KEY = keys.connections();

export const useConnections = () => useQuery({ queryKey: CONNECTIONS_KEY, queryFn: connectionsApi.list });

const detailOf = (c: ConnectionDto["check"]): string => ("value" in c && c.value ? c.value.detail : c.state === "error" ? `${c.message} ${c.fix}` : "");

/**
 * Everything the page does to a connection, one at a time: Test, Set key, Remove. Each reply is the one row, which patches the cached list;
 * one sentence reaches the live region (`status` for a result, `alert` for a failure). A key is an argument of `save` and goes nowhere else:
 * not into a mutation's variables, the Query cache or the status text (the reply and the server's sentences hold no value, decision 0020).
 */
export function useConnectionActions() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<{ text: string; kind: "status" | "alert" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const patch = useCallback((row: ConnectionDto) => qc.setQueryData<ConnectionsDto>(CONNECTIONS_KEY, (old) => old && { ...old, connections: old.connections.map((c) => (c.id === row.id ? row : c)) }), [qc]);

  /** Runs one call for one row. True when it went through. A failure is announced and returns false. */
  const run = useCallback(
    async (id: string, working: string, failed: string, call: () => Promise<ConnectionDto>, done: (row: ConnectionDto) => { text: string; kind: "status" | "alert" }): Promise<boolean> => {
      setBusy(id);
      setStatus({ text: working, kind: "status" });
      try {
        const row = await call();
        patch(row);
        setStatus(done(row));
        return true;
      } catch (e) {
        setStatus({ text: `${failed}: ${sentence(e)}`, kind: "alert" });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [patch],
  );

  const test = useCallback(
    (row: ConnectionDto) =>
      run(row.id, `Testing ${row.label}...`, `Could not test ${row.label}`, () => connectionsApi.test(row.id), (r) => ({ text: `${r.label}: ${r.check.state === "error" ? "test failed. " : ""}${detailOf(r.check)}`.trim(), kind: r.check.state === "error" ? "alert" : "status" })),
    [run],
  );
  const save = useCallback(
    (row: ConnectionDto, body: SetSecretBody) =>
      run(row.id, `Saving ${row.label}...`, `Could not save ${row.label}`, () => connectionsApi.setSecret(row.id, body), (r) => ({ text: `${r.label}: key saved. Press Test to check it.`, kind: "status" })),
    [run],
  );
  const remove = useCallback(
    (row: ConnectionDto) => run(row.id, `Removing ${row.label}...`, `Could not remove ${row.label}`, () => connectionsApi.remove(row.id), (r) => ({ text: `${r.label}: key removed.`, kind: "status" })),
    [run],
  );
  return { status, busy, test, save, remove };
}
