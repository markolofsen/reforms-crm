import { useQuery } from "@tanstack/react-query";
import { phrase } from "@hub/contract/help";
import type { DoctorDto } from "@hub/contract/responses";
import { ActionButton } from "@hub/ui/product/action-button";
import { CopyFix } from "@/components/copy-fix";
import { FactLine } from "@/components/fact-line";
import { sendApi } from "@/lib/api/send";
import { keys } from "@/lib/cache/keys";
import { plural } from "@/lib/format";

type Facts = NonNullable<DoctorDto["facts"]>;

/** The project doctor (`hub project doctor`): its facts carry the send policy as the server reads it (one key, `state-and-data.md` rule 2). */
export const useDoctor = (project: string) => useQuery({ queryKey: keys.doctor(project), queryFn: () => sendApi.doctor(project) });

const TO: Record<Facts["recipients"], (f: Facts) => string> = {
  test: () => "The test list only",
  any: () => "Any address",
  list: (f) => `Only ${plural(f.listed, "listed address", "listed addresses")}`,
};

/** "Off", or "On for client and partner, at most 5 a day". */
const autosendText = (a: Facts["autosend"]): string => (a.mode !== "auto" ? "Off: a person sends every mail" : `On for ${a.classes.join(", ") || "no class"}, at most ${a.dailyCap} a day`);

type Command = { lead: string; line: string };

/**
 * One read-only line of the send policy: its name and what it is; under it, when the owner can change it, what the command
 * does and the command with its copy button (UX pass 2026-11-20: a bare command beside the value needed explaining).
 */
function PolicyLine({ title, summary, command, testId }: { title: string; summary: string; command: Command | null; testId: string }) {
  return (
    <li className="flex min-h-(--control-m) min-w-0 flex-col gap-1 px-4 py-2 text-sm sm:flex-row sm:items-baseline sm:gap-3" data-testid={testId}>
      <span className="w-28 shrink-0 font-medium sm:w-36">{title}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="break-words text-muted-foreground">{summary}</span>
        {command && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
            {command.lead}
            <code className="min-w-0 break-all rounded-sm bg-muted px-1.5 py-0.5 text-foreground">{command.line}</code>
            <CopyFix fix={command.line} />
          </span>
        )}
      </span>
    </li>
  );
}

/** While the doctor is read or failed, a line still stands in its place and says so. */
function Pending({ q }: { q: ReturnType<typeof useDoctor> }) {
  if (!q.isError) return <FactLine summary="Reading..." title="Send to" />;
  return (
    <FactLine open summary="Could not be read" title="Send to" tone="problem">
      <div>
        <ActionButton disabled={q.isFetching} onClick={() => void q.refetch()} size="s" variant="secondary">
          Retry
        </ActionButton>
      </div>
    </FactLine>
  );
}

/**
 * Who drafts may go to and whether the hub sends by itself: the send policy (P49 S11), read only. It is the owner's alone, kept
 * out of the agent's reach on purpose, so the way to change it is his own command in his shell, shown with its copy button
 * (P70 Q1), never a phrase to the agent and never a switch here.
 */
export function SendPolicyLines({ project }: { project: string }) {
  const q = useDoctor(project);
  if (!q.data) return <Pending q={q} />;
  const f = q.data.facts;
  if (!f) return <FactLine open summary={`No project.md yet. Say “${phrase("project-setup", project)}” in a session (project-setup).`} title="Send to" tone="problem" />;
  const toAll = { lead: "To send to anyone, run in your shell:", line: `./run.sh send policy set ${project} draft.recipients any` };
  const toTest = { lead: "To go back to the test list, run in your shell:", line: `./run.sh send policy set ${project} draft.recipients test` };
  return (
    <>
      <PolicyLine command={f.recipients === "any" ? toTest : toAll} summary={TO[f.recipients](f)} testId="send-to" title="Send to" />
      <PolicyLine command={null} summary={autosendText(f.autosend)} testId="autosend" title="Autosend" />
    </>
  );
}
