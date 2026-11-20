import type { ReactNode } from "react";
import type { ProjectOverviewDto } from "@hub/contract/responses";
import { phrase } from "@hub/contract/help";
import { plural } from "@/lib/format";

/** The Filters row: its name, what stands, and under it whatever more there is to read, always in view (P75: nothing folded). */
export function FilterRow({ summary, problem = false, children }: { summary: string; problem?: boolean; children?: ReactNode }) {
  return (
    <li className="flex min-h-(--control-m) min-w-0 flex-col gap-1 px-4 py-2 text-sm sm:flex-row sm:items-baseline sm:gap-3" data-testid="mail-filters">
      <span className="w-28 shrink-0 font-medium sm:w-36">Filters</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={problem ? "break-words text-warning-foreground" : "break-words"}>{summary}</span>
        {children}
      </span>
    </li>
  );
}

/**
 * Settings ▸ Mail ▸ Filters (P70): the rules and the whitelist, read only, as one row; the phrase that changes them is shown under
 * it in muted text, and a problem in the rules file is listed there too (P75: the phrase was folded until then).
 */
export function FiltersLine({ f }: { f: ProjectOverviewDto["filters"] }) {
  const change = <p className="measure text-muted-foreground">To change them, say “{phrase("mail-filters")}” in a session (mail-filters).</p>;
  if (f.state === "absent") return <FilterRow summary={`None yet. Say “${phrase("mail-filters")}” in a session (mail-filters).`} />;
  if (f.state === "error") return <FilterRow problem summary={f.message} />;
  const summary = `${plural(f.rules, "rule")}, ${f.whitelist} on the whitelist`;
  if (f.issues.length === 0) return <FilterRow summary={summary}>{change}</FilterRow>;
  return (
    <FilterRow problem summary={`${summary}; the rules file has problems`}>
      <ul className="list-disc ps-5">
        {f.issues.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      {change}
    </FilterRow>
  );
}
