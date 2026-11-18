import type { ProjectOverviewDto } from "@hub/contract/responses";
import { plural } from "@/lib/format";
import { FactLine } from "./fact-line";

// What the project folder says (`GET /api/project`), one line per fact. Each section is read on its own, so one broken
// file is that line's problem and never blanks the screen.

/** The knowledge base: how many entries and whether they are approved; an expired entry or a broken file opens the line. */
export function KnowledgeLine({ k }: { k: ProjectOverviewDto["knowledge"] }) {
  if (k.state === "absent") return <FactLine summary='None yet. Say "загрузи знания проекта" in a session (knowledge-import).' title="Knowledge" />;
  if (k.state === "error") return <FactLine open summary={k.message} title="Knowledge" tone="problem" />;
  const problem = !k.consistent || k.expired > 0;
  const approval = k.unapproved === 0 ? "all approved" : `${k.unapproved} not approved`;
  const summary = [`${k.indexed} ${k.indexed === 1 ? "entry" : "entries"}`, approval, k.expired > 0 ? `${k.expired} expired` : null].filter(Boolean).join(", ");
  return (
    <FactLine open={problem} summary={summary} title="Knowledge" tone={problem ? "problem" : "plain"}>
      <p className="tabular-nums">
        {k.noAudiences} without audiences, {k.noPhrasings} without phrasings.
      </p>
      {!k.consistent && <p className="text-warning-foreground">{plural(k.problems, "file problem")}: ask the agent to re-run `hub knowledge index`.</p>}
      {k.examples.length > 0 && (
        <ul className="list-disc ps-5 text-muted-foreground text-xs">
          {k.examples.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </FactLine>
  );
}

/** The mail filters: the rules and the whitelist; a problem in the rules file opens the line. */
export function FiltersLine({ f }: { f: ProjectOverviewDto["filters"] }) {
  if (f.state === "absent") return <FactLine summary='None yet. Say "настрой фильтры почты проекта" in a session (mail-filters).' title="Mail filters" />;
  if (f.state === "error") return <FactLine open summary={f.message} title="Mail filters" tone="problem" />;
  const summary = `${plural(f.rules, "rule")}, ${f.whitelist} on the whitelist`;
  if (f.issues.length === 0) return <FactLine summary={summary} title="Mail filters" />;
  return (
    <FactLine open summary={`${summary}; the rules file has problems`} title="Mail filters" tone="problem">
      <ul className="list-disc ps-5">
        {f.issues.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </FactLine>
  );
}

/** A question the agent left in project.md for the owner: answered in a session, shown here so it is not missed. */
export function QuestionLine({ q }: { q: ProjectOverviewDto["question"] }) {
  if (!q) return null;
  return (
    <FactLine open summary={q.question} title="Open question" tone="problem">
      <p className="measure">{q.question}</p>
      {q.options.length > 0 && <p className="text-muted-foreground">Answer in a session: {q.options.join(", ")}.</p>}
    </FactLine>
  );
}
