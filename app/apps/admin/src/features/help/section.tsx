"use client";

import { Page } from "@hub/ui/product/page";
import { AppLink } from "@/components/app-link";
import { LocalActionButton } from "@/components/local-action";
import { SectionTitle } from "@hub/ui/product/page";
import { useProjectScope } from "@/hooks/use-project";
import { useInstance } from "@/lib/status";
import { paths } from "@/routes/paths";

const ROW = "flex min-h-(--control-m) min-w-0 items-center gap-3 py-1.5";

/** The places, one pattern each (UX pass 2026-11-20): the name, one line of what it holds, its Open. */
const PLACES = [
  { name: "project.md", what: "The project’s settings and notes", action: "file.open", key: "project.md" },
  { name: "Project folder", what: "Everything the agent keeps for this project", action: "finder.open", key: "project" },
  { name: "Workflows", what: "The steps the agent follows for each kind of mail", action: "finder.open", key: "workflows" },
] as const;

/**
 * Where the project's own files live (P70, the Files menu's items; P63 patch B adds Today's log): Help is the one screen whose
 * question is "where is it" (`admin-principles.md` rule 12). Each row is the place, what it holds and its Open (P61), hidden
 * when this machine cannot open. A change to any of them is still a phrase to the agent.
 */
function WhereThingsLive() {
  const { project, multi } = useProjectScope();
  const instance = useInstance();
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
              <LocalActionButton action="file.open" args={{ project, key: p.key }}>
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

/**
 * The Help screen (route `/help`, projectless, `g h`): where the wiring is shown, where the shortcuts are, and where the project's
 * files live (P70: the Files menu's items, each with its Open). P63 patch B adds the phrases to say (from the skills' own
 * metadata) and today's log. No copy of the `?` list: the popover stays the one list.
 */
export function HelpScreen() {
  return (
    <Page>
      {/* The shell's heading names the screen (Help); a second one here would say it twice. */}
      <section aria-label="Help" className="flex flex-col gap-4 text-sm" data-testid="help">
        <p className="measure">
          Press <kbd className="rounded-sm border px-1 font-mono text-xs">?</kbd> on any screen for its shortcuts; how each part of the Hub stands, and where it is
          fixed, is on <AppLink to={paths.overview()}>Overview</AppLink>.
        </p>
        <WhereThingsLive />
      </section>
    </Page>
  );
}
