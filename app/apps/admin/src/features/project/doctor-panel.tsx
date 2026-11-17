import { useQuery } from "@tanstack/react-query";
import { LoadFailed, Loading } from "@/components/state-views";
import { Badge } from "@hub/ui/badge";
import { sendApi } from "@/lib/api/send";

const OUTCOME = { pass: { label: "Pass", variant: "success" }, fail: { label: "Fail", variant: "error" }, skipped: { label: "Skipped", variant: "secondary" } } as const;

/**
 * The project doctor (`hub project doctor`) on screen: project.md, the kind, the sender, addresses, send settings and the
 * knowledge index. The checks that need Mail.app or Notion are not run by the server and show as skipped.
 */
export function DoctorPanel({ project }: { project: string }) {
  const q = useQuery({ queryKey: ["doctor", project], queryFn: () => sendApi.doctor(project) });
  if (q.isPending) return <Loading what="the health checks" />;
  if (q.isError) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the health checks" />;
  if (q.data.state === "absent") return <p className="text-muted-foreground text-sm">This project has no project.md yet. Ask the agent to set it up (skill project-setup).</p>;
  const { checks } = q.data;
  const count = (o: keyof typeof OUTCOME) => checks.filter((c) => c.outcome === o).length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm tabular-nums" role="status">
        {count("pass")} pass, {count("fail")} fail, {count("skipped")} skipped.{" "}
        <span className="text-muted-foreground">Run `hub project doctor {project}` for the Mail and Notion checks.</span>
      </p>
      <ul aria-label="Health checks" className="divide-y">
        {checks.map((c) => (
          <li className="flex min-w-0 flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:gap-3" key={c.name}>
            <span className="flex items-center gap-2 sm:w-72 sm:shrink-0">
              <Badge variant={OUTCOME[c.outcome].variant}>{OUTCOME[c.outcome].label}</Badge>
              <span className="font-medium text-sm">{c.name}</span>
            </span>
            <span className="min-w-0 break-words text-muted-foreground text-sm">{c.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
