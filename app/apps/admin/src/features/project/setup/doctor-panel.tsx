import { useQuery } from "@tanstack/react-query";
import type { DoctorDto } from "@hub/contract/responses";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { sendApi } from "@/lib/api/send";
import { FactLine } from "../fact-line";
import { keys } from "@/lib/cache/keys";

const OUTCOME = { pass: { label: "Pass", variant: "success" }, warn: { label: "To answer", variant: "warning" }, fail: { label: "Fail", variant: "error" }, skipped: { label: "Skipped", variant: "secondary" } } as const;
const RECIPIENTS: Record<NonNullable<DoctorDto["facts"]>["recipients"], string> = { test: "drafts go to the test list only", any: "drafts may go to any address", list: "drafts go to the listed addresses only" };

/** The project doctor (`hub project doctor`), read once for the Health and Setup lines (one key, `state-and-data.md` rule 2). */
const useDoctor = (project: string) => useQuery({ queryKey: keys.doctor(project), queryFn: () => sendApi.doctor(project) });

/** While the doctor is read or failed, a line still stands in its place and says so. */
function Pending({ title, q }: { title: string; q: ReturnType<typeof useDoctor> }) {
  if (!q.isError) return <FactLine summary="Reading..." title={title} />;
  return (
    <FactLine open summary="Could not be read" title={title} tone="problem">
      <div>
        <ActionButton disabled={q.isFetching} onClick={() => void q.refetch()} size="s" variant="secondary">
          Retry
        </ActionButton>
      </div>
    </FactLine>
  );
}

/**
 * Health: the doctor's checks in one line ("7 of 7 checks pass"). A failing check opens the line and comes first. The checks
 * that need Mail or Notion are not run by the server; they are the agent's to run in a session.
 */
export function HealthLine({ project }: { project: string }) {
  const q = useDoctor(project);
  if (!q.data) return <Pending q={q} title="Health" />;
  if (q.data.state === "absent") return <FactLine open summary='No project.md yet. Say "настрой проект" in a session (project-setup).' title="Health" tone="problem" />;
  const { checks } = q.data;
  const run = checks.filter((c) => c.outcome !== "skipped");
  const failed = run.filter((c) => c.outcome === "fail").length;
  const skipped = checks.length - run.length;
  const warned = run.filter((c) => c.outcome === "warn").length;
  const summary = `${run.length - failed - warned} of ${run.length} checks pass${warned > 0 ? `, ${warned} to answer` : ""}${skipped > 0 ? ` (${skipped} need the agent's session)` : ""}`;
  const ordered = [...checks].sort((a, b) => Number(b.outcome === "fail") - Number(a.outcome === "fail"));
  return (
    <FactLine open={failed > 0} summary={summary} title="Health" tone={failed > 0 ? "problem" : "plain"}>
      <ul aria-label="Health checks" className="flex flex-col divide-y">
        {ordered.map((c) => (
          <li className="flex min-w-0 flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:gap-3" key={c.name}>
            <span className="flex items-center gap-2 sm:w-72 sm:shrink-0">
              <Badge variant={OUTCOME[c.outcome].variant}>{OUTCOME[c.outcome].label}</Badge>
              <span className="font-medium">{c.name}</span>
            </span>
            <span className="min-w-0 break-words text-muted-foreground">{c.detail}</span>
          </li>
        ))}
      </ul>
      {skipped > 0 && <p className="measure text-muted-foreground text-xs">The skipped checks need Mail or Notion: the agent runs them in a session (`hub project doctor {project}`).</p>}
    </FactLine>
  );
}

/** Setup, read-only: the project's status and who a draft may go to. Both live in project.md, so a change is a phrase to the agent. */
export function SetupLine({ project }: { project: string }) {
  const q = useDoctor(project);
  if (!q.data) return <Pending q={q} title="Setup" />;
  const facts = q.data.facts;
  if (!facts) return null;
  return (
    <FactLine summary={`${facts.status} project, ${RECIPIENTS[facts.recipients]}`} title="Setup">
      <p className="measure text-muted-foreground">To change the status or who drafts may go to, say “настрой проект” in a session (project-setup): the agent edits project.md.</p>
    </FactLine>
  );
}
