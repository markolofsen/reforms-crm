"use client";

import { Page } from "@hub/ui/product/shell/page";
import { HowItWorks } from "./how-it-works";
import { WhereThingsLive } from "./places";
import { SayTable } from "./say-table";
import { TipsList } from "./tips-list";

/**
 * The Help screen (route `/help`, projectless, `g h`; P63 O2 and O3): what to say to the agent, the tips for each agent CLI,
 * where the project's files live (each with its Open, P70), and last how the Hub is wired, drawn live (Mermaid, loaded only
 * here). One opening line for the shortcuts: the `?` popover stays the one list, never copied here.
 */
export function HelpScreen() {
  return (
    <Page>
      {/* The shell's heading names the screen (Help); a second one here would say it twice. */}
      <div className="flex min-w-0 flex-col gap-6 text-sm" data-testid="help">
        <p className="measure">
          Press <kbd className="rounded-sm border px-1 font-mono text-xs">?</kbd> on any screen for its shortcuts.
        </p>
        <SayTable />
        <TipsList />
        <WhereThingsLive />
        <HowItWorks />
      </div>
    </Page>
  );
}
