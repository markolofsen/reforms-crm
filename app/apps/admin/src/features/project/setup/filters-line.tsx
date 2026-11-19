import type { ProjectOverviewDto } from "@hub/contract/responses";
import { plural } from "@/lib/format";
import { FactLine } from "../fact-line";

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
