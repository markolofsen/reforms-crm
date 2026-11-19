import type { ProjectOverviewDto } from "@hub/contract/responses";
import { plural } from "@/lib/format";
import { FactLine } from "@/components/fact-line";

/** Settings ▸ Mail ▸ Filters (P70): the rules and the whitelist, read only; a problem in the rules file opens the line. A change is a phrase. */
export function FiltersLine({ f }: { f: ProjectOverviewDto["filters"] }) {
  if (f.state === "absent") return <FactLine summary='None yet. Say "настрой фильтры почты проекта" in a session (mail-filters).' title="Filters" />;
  if (f.state === "error") return <FactLine open summary={f.message} title="Filters" tone="problem" />;
  const summary = `${plural(f.rules, "rule")}, ${f.whitelist} on the whitelist`;
  if (f.issues.length === 0)
    return (
      <FactLine summary={summary} title="Filters">
        <p className="measure text-muted-foreground">To change them, say “настрой фильтры почты проекта” in a session (mail-filters).</p>
      </FactLine>
    );
  return (
    <FactLine open summary={`${summary}; the rules file has problems`} title="Filters" tone="problem">
      <ul className="list-disc ps-5">
        {f.issues.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </FactLine>
  );
}
