import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { API_VERSION } from "@hub/contract/health";
import { refreshData } from "../api/client";
import { metaApi } from "../api/meta";
import { keys } from "./keys";
import { useLiveState } from "./live";

const PULSE_MS = 10_000;

/**
 * The server's pulse: its health and version, and the fallback for live updates. While the live stream is up (P50)
 * it is read on open, on focus and on a `health` event only; while the stream is down it is polled every 10 s, and a
 * moved database file (`PRAGMA data_version`) refetches every list, as before P50. `stale` is true when the pulse cannot
 * be read, so the screen says its data may be old instead of looking fine.
 */
export function usePulse() {
  const qc = useQueryClient();
  const live = useLiveState() === "live";
  const query = useQuery({ queryKey: keys.pulse(), queryFn: metaApi.pulse, refetchInterval: live ? false : PULSE_MS, staleTime: 0, retry: false });
  const seen = useRef<number | null>(null);
  const version = query.data?.dataVersion ?? null;
  useEffect(() => {
    if (version === null) return;
    if (!live && seen.current !== null && seen.current !== version) void refreshData(qc);
    seen.current = version;
  }, [version, qc, live]);
  const health = query.data?.health ?? null;
  return { health, stale: query.isError, serverOlder: health !== null && health.apiVersion < API_VERSION, serverNewer: health !== null && health.apiVersion > API_VERSION };
}
