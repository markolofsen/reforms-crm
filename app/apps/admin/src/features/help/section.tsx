"use client";

import { Page } from "@hub/ui/product/page";
import { AppLink } from "@/components/app-link";
import { LocalActionButton } from "@/components/local-action";
import { useProjectScope } from "@/hooks/use-project";
import { useInstance } from "@/lib/status";
import { paths } from "@/routes/paths";

const ROW = "flex min-h-(--control-m) min-w-0 items-center gap-2 py-1";

/**
 * Where the project's own files live (P70, the Files menu's items; P63 patch B adds Today's log): Help is the one screen whose
 * question is "where is it" (`admin-principles.md` rule 12). Each is an Open (P61), hidden when this machine cannot open. A change
 * to any of them is still a phrase to the agent.
 */
function WhereThingsLive() {
  const { project, multi } = useProjectScope();
  const instance = useInstance();
  if (instance.data?.localOpen !== true) return null;
  const open = (label: string) => (
    <span>
      Open<span className="sr-only"> {label}</span>
    </span>
  );
  return (
    <section aria-labelledby="help-files" className="flex flex-col gap-1">
      <h3 className="font-heading font-medium" id="help-files">
        Where things live{multi ? ` (${project})` : ""}
      </h3>
      <ul className="flex flex-col divide-y border-y">
        <li className={ROW}>
          <span className="min-w-0 flex-1">project.md: the project’s settings and notes</span>
          <LocalActionButton action="file.open" args={{ project, key: "project.md" }}>
            {open("project.md")}
          </LocalActionButton>
        </li>
        <li className={ROW}>
          <span className="min-w-0 flex-1">The project folder</span>
          <LocalActionButton action="finder.open" args={{ project, key: "project" }}>
            {open("the project folder")}
          </LocalActionButton>
        </li>
        <li className={ROW}>
          <span className="min-w-0 flex-1">Workflows</span>
          <LocalActionButton action="finder.open" args={{ project, key: "workflows" }}>
            {open("Workflows")}
          </LocalActionButton>
        </li>
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
      <section aria-label="Help" className="measure flex flex-col gap-3 text-sm" data-testid="help">
        <p>
          How this Hub stands, part by part, and where each part is fixed: <AppLink to={paths.overview()}>see Overview</AppLink>.
        </p>
        <p>
          Press <kbd className="rounded-sm border px-1 font-mono text-xs">?</kbd> on any screen for the shortcuts it has.
        </p>
        <WhereThingsLive />
      </section>
    </Page>
  );
}
