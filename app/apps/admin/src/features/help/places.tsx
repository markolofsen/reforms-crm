import { SectionTitle } from "@hub/ui/product/shell/page";
import { LocalActionButton } from "@/components/local-action";
import { useProjectScope } from "@/hooks/use-project";
import { useClock } from "@/lib/clock";
import { useInstance } from "@/lib/data/instance";

const ROW = "flex min-h-(--control-m) min-w-0 items-center gap-3 py-1.5";

/** The places, one pattern each (UX pass 2026-11-20): the name, one line of what it holds, its Open. */
const PLACES = [
  { name: "project.md", what: "The project’s settings and notes", action: "file.open", key: "project.md" },
  { name: "Project folder", what: "Everything the agent keeps for this project", action: "finder.open", key: "project" },
  { name: "Workflows", what: "The steps the agent follows for each kind of mail", action: "finder.open", key: "workflows" },
  { name: "Today’s log", what: "What the agent was asked and did today", action: "file.open", key: "log" },
] as const;

/**
 * Where the project's own files live (P70, the Files menu's items; P63 patch B adds today's agent log): Help is the one screen
 * whose question is "where is it" (`admin-principles.md` rule 12). Each row is the place, what it holds and its Open (P61),
 * hidden when this machine cannot open. A change to any of them is still a phrase to the agent. The log's day is the log's own
 * (UTC, `@hub/log`); a day with nothing logged yet answers "Not opened" with the server's reason.
 */
export function WhereThingsLive() {
  const { project, multi } = useProjectScope();
  const instance = useInstance();
  const now = useClock();
  if (instance.data?.localOpen !== true) return null;
  return (
    <section aria-labelledby="help-files" className="flex flex-col gap-1">
      <SectionTitle id="help-files">Where things live{multi ? ` (${project})` : ""}</SectionTitle>
      <ul className="flex flex-col divide-y border-y">
        {PLACES.map((p) => (
          <li className={ROW} key={p.key}>
            <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:gap-3">
              <span className="font-medium sm:w-36 sm:shrink-0">{p.name}</span>
              <span className="min-w-0 text-muted-foreground">{p.what}</span>
            </span>
            {p.action === "file.open" ? (
              <LocalActionButton action="file.open" args={{ project, key: p.key === "log" ? `log:${new Date(now()).toISOString().slice(0, 10)}` : p.key }}>
                <span>
                  Open<span className="sr-only"> {p.name}</span>
                </span>
              </LocalActionButton>
            ) : (
              <LocalActionButton action="finder.open" args={{ project, key: p.key }}>
                <span>
                  Open<span className="sr-only"> {p.name}</span>
                </span>
              </LocalActionButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
