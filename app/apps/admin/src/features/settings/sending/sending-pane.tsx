import { Skeleton } from "@hub/ui/skeleton";
import { AppLink } from "@/components/app-link";
import { LoadFailed } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { useCommand } from "@/lib/cache/topics";
import { sendApi } from "@/lib/api/send";
import { useProjectRow, useSends } from "@/lib/status";
import { dest } from "@/routes/paths";
import { SendPolicyLines } from "./send-to";
import { StopSending } from "./stop-sending";

/**
 * Sending's one sentence: the project's worst fact when Sending is where it is fixed (stopped, failed or stuck sends, the cap),
 * else whether sending runs. Test mode is not said here: it is a setting, and the Send to line below says it (UX pass 2026-11-20:
 * the headline and that line said the same thing).
 */
function useSendingSentence(project: string, stopped: readonly string[] | undefined): { text: string | null; sends: boolean } {
  const { row, isError } = useProjectRow(project);
  if (row && row.status.level !== "clear" && row.status.next === "sending") return { text: row.status.sentence, sends: row.status.kind === "send-failed" || row.status.kind === "sending-stuck" };
  if (stopped === undefined) return { text: isError ? "The sending status could not be read." : null, sends: false };
  return { text: stopped.includes("*") || stopped.includes(project) ? "Sending is stopped" : "Sending is on", sends: false };
}

/** Stop sending and Resume, for this project or every project. */
function useStop() {
  // The scope may be every project, so the topics are invalidated for all of them (a null project is every project's prefix).
  const stop = useCommand({ project: null, touches: ["sends", "projects"], run: (scope: string) => sendApi.stop(scope) });
  const resume = useCommand({ project: null, touches: ["sends", "projects"], run: (scope: string) => sendApi.resume(scope) });
  return { stop, resume, busy: stop.isPending || resume.isPending, failed: [stop, resume].find((m) => m.isError)?.error ?? null };
}

/**
 * Settings ▸ Sending (P70, `/settings`, where Settings opens): what lets a mail out, in the order of `admin-principles.md` rule 9.
 * The sentence and the one control, Stop sending or Resume; who drafts may go to and autosend, read only with the owner's
 * command. The checks before sending are their own pane, Settings ▸ Checks (P75). Controls only: the send history is Activity ▸
 * Sends (UX pass), and a failed or stuck send in the sentence links there.
 */
export function SendingPane({ project }: { project: string }) {
  const q = useSends(project);
  const { stop, resume, busy, failed } = useStop();
  const said = useSendingSentence(project, q.data?.stopped);
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex min-h-(--control-m) flex-wrap items-center gap-3">
          <div className="me-auto font-medium text-base" data-testid="sending-status" role="status">
            {said.text ?? <Skeleton className="h-4 w-64" />}
            {said.sends && (
              <>
                {" · "}
                <AppLink className="font-normal text-sm" to={dest("log.list", { kind: "sends" })}>
                  See the sends
                </AppLink>
              </>
            )}
          </div>
          <StopSending busy={busy || !q.data} onResume={(scope) => resume.mutate(scope)} onStop={(scope) => stop.mutate(scope)} project={project} stopped={q.data?.stopped ?? []} />
        </div>
        <p className="text-destructive-foreground text-sm" role="alert">
          {failed ? sentence(failed) : ""}
        </p>
      </div>
      {q.isError && <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the sending status" />}
      <ul aria-label="Sending settings" className="flex flex-col divide-y border-y">
        <SendPolicyLines project={project} />
      </ul>
    </>
  );
}
