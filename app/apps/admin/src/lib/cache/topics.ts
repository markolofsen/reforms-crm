import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { LiveTopic } from "@hub/contract/live";
import { TOPIC_KEYS } from "./keys";

/**
 * P127 B2 (V4): a write names the live topics of the tables it writes, and the same map the stream applies (`TOPIC_KEYS`)
 * invalidates the keys, so a command and the frame that follows it refresh the same reads. It replaces a feature's
 * `refreshData` (every query) and hand `invalidateQueries`. Reading Mail again is `touches: [..., "mail"]`.
 */
export function invalidateTopics(qc: QueryClient, project: string | null, touches: readonly LiveTopic[]): Promise<void> {
  const queryKeys = touches.flatMap((t) => TOPIC_KEYS[t](project));
  return Promise.all(queryKeys.map((queryKey) => qc.invalidateQueries({ queryKey }))).then(() => undefined);
}

/**
 * One write of a screen: `run` posts it, and on success and on failure (a refusal can still have changed a row) the touched topics
 * are invalidated. The mutation's `isPending` disables the control and its `error` is said inline (state rule 6).
 */
export function useCommand<V, R>(o: { project: string | null; touches: readonly LiveTopic[]; run: (v: V) => Promise<R>; onSuccess?: (r: R, v: V) => void; onError?: (e: unknown) => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: o.run,
    onSuccess: o.onSuccess,
    onError: o.onError,
    onSettled: () => invalidateTopics(qc, o.project, o.touches),
  });
}

/**
 * The same invalidation for a write that is not one mutation of a screen: a toast's Undo, a batch's own Undo, a run that moved on
 * (P127 C2). `refresh(touches)` invalidates exactly `TOPIC_KEYS` of those topics.
 */
export function useRefreshTopics(project: string | null) {
  const qc = useQueryClient();
  return (touches: readonly LiveTopic[]) => invalidateTopics(qc, project, touches);
}
