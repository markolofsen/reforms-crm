"use client";

import { Page } from "@hub/ui/product/page";
import { AppLink } from "@/components/app-link";
import { paths } from "@/routes/paths";

/**
 * The Help screen (route `/help`, projectless, `g h`). P63 patch A ships it with two lines, so the nav entry leads somewhere real:
 * where the wiring is shown and where the shortcuts are. Patch B adds the phrases to say (from the skills' own metadata) and
 * where the project's files live, each with its Open (P61). No copy of the `?` list: the popover stays the one list.
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
      </section>
    </Page>
  );
}
