import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ProjectOverviewDto } from "@hub/contract/responses";
import { LoadFailed, Loading } from "@/components/state-views";
import { Alert, AlertDescription, AlertTitle } from "@hub/ui/alert";
import { Badge } from "@hub/ui/badge";
import { metaApi } from "@/lib/api/meta";
import { formatTime, plural } from "@/lib/format";
import { DoctorPanel } from "./doctor-panel";
import { SafetyRules } from "./safety-rules";
import { SendsPanel } from "./sends-panel";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="font-heading font-medium text-sm">{title}</h3>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Absent({ what, how }: { what: string; how: string }) {
  return (
    <p className="text-muted-foreground text-sm">
      No {what} yet. {how}
    </p>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <Alert variant="error">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function Knowledge({ k }: { k: ProjectOverviewDto["knowledge"] }) {
  if (k.state === "absent") return <Absent how="Ask the agent: загрузи знания проекта (skill knowledge-import)." what="knowledge folder" />;
  if (k.state === "error") return <Failed message={k.message} />;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="tabular-nums">
        {k.indexed} indexed, {k.approved} approved, {k.unapproved} not approved, {k.expired} expired.
      </p>
      <p className="text-muted-foreground tabular-nums">
        {k.noAudiences} without audiences, {k.noPhrasings} without phrasings.
      </p>
      {!k.consistent && <Badge variant="warning">{plural(k.problems, "file problem")}: re-run `hub knowledge index`</Badge>}
      {k.examples.length > 0 && <ul className="list-disc ps-5 text-muted-foreground text-xs">{k.examples.map((e) => <li key={e}>{e}</li>)}</ul>}
    </div>
  );
}

function Filters({ f }: { f: ProjectOverviewDto["filters"] }) {
  if (f.state === "absent") return <Absent how="Ask the agent: настрой фильтры почты проекта (skill mail-filters)." what="mail filters" />;
  if (f.state === "error") return <Failed message={f.message} />;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="tabular-nums">
        {plural(f.rules, "rule")}, {f.whitelist} on the whitelist.
      </p>
      {f.issues.length > 0 && (
        <Alert variant="warning">
          <AlertTitle>The rules file has problems</AlertTitle>
          <AlertDescription>
            <ul className="list-disc ps-5">{f.issues.map((i) => <li key={i}>{i}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** One project at a glance: its profile, knowledge, mail filters and safety rules. Read-only except the rules. */
export function ProjectPage({ project }: { project: string }) {
  const q = useQuery({ queryKey: ["overview", project], queryFn: () => metaApi.overview(project) });
  if (q.isPending) return <Loading what="the project" />;
  if (q.isError) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the project" />;
  const { project: p, question, knowledge, filters } = q.data;
  return (
    <div className="flex flex-col gap-3">
      <Section hint={p ? `Synced ${formatTime(p.syncedAt)}` : undefined} title="Profile">
        {p ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{p.name}</span>
            <Badge variant={p.status === "active" ? "success" : "secondary"}>{p.status}</Badge>
            <Badge variant="outline">{p.kind}</Badge>
          </p>
        ) : (
          <Absent how="Run `hub project sync` after project-setup." what="registry entry" />
        )}
        {question && (
          <Alert variant="info">
            <AlertTitle>Open question</AlertTitle>
            <AlertDescription>{question.question}</AlertDescription>
          </Alert>
        )}
      </Section>
      <Section hint="project.md, the kind, send settings, the index" title="Health">
        <DoctorPanel project={project} />
      </Section>
      <Section hint="every send is logged with its full text" title="Sends">
        <SendsPanel project={project} />
      </Section>
      <Section hint="from knowledge/" title="Knowledge">
        <Knowledge k={knowledge} />
      </Section>
      <Section hint="from mail-filters.md" title="Mail filters">
        <Filters f={filters} />
      </Section>
      <Section hint="A rule that fires must be understood before a draft can be sent" title="Safety rules">
        <SafetyRules project={project} />
      </Section>
    </div>
  );
}
