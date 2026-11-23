import { Skeleton } from "@hub/ui/skeleton";
import { AppLink } from "@/components/app-link";
import { QueryView } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { useProjectRow } from "@/lib/data/overview";
import { useSends, useStopSending } from "@/lib/data/project";
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
  const { stop, resume } = useStopSending();
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
      {/* The status line above draws the data (or its skeleton); this says only a failed read, or a stale one under the data. */}
      <QueryView loading={<></>} query={q} what="the sending status">
        {() => null}
      </QueryView>
      <ul aria-label="Sending settings" className="flex flex-col divide-y border-y">
        <SendPolicyLines project={project} />
      </ul>
    </>
  );
}
