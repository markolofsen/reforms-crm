"use client";

import { CopyIcon, PanelRightCloseIcon, PlusIcon, XIcon } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { PRESET_LABELS, type CliFactDto, type CliState, type TerminalPreset, type TerminalProblemDto, type TerminalSessionDto } from "@hub/contract/terminal";
import { cn } from "@hub/ui/cn";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import { DesktopHandoffButton } from "@/components/local-action";
import { copyText } from "@/lib/external";
import { useSharedFocus } from "@/lib/focus";
import { agentSeesLine } from "./agent-sees";
import { panelId, tabId } from "./session";
import { useTerminal } from "./use-terminal";

/** A tab's name: the session's title, with the project's slug when the title does not carry it, and the exit code once it ended. */
export function tabTitle(s: TerminalSessionDto): string {
  const title = s.project && !s.title.includes(s.project) ? `${s.title} · ${s.project}` : s.title;
  return s.state === "exited" ? `${title} (exit ${s.exitCode ?? "?"})` : title;
}

/** What the `+` menu says of a CLI the detector found not ready (P57 2j); a ready or unchecked one says nothing. */
const STATE_NOTE: Record<CliState, string | null> = { ready: null, "signed-out": "not signed in", missing: "not installed", unknown: null };

/** A preset's fact: Shell has none. */
const factOf = (clis: readonly CliFactDto[], p: TerminalPreset): CliFactDto | undefined => (p === "shell" ? undefined : clis.find((c) => c.cli === p));

/**
 * The `+` menu: the presets the server offers here, in its order; the first is the default. Without a project, only Shell. A CLI
 * that is not installed is disabled with its reason; one not signed in says so and still starts (its first screen signs in).
 * When no tab can start (P66), every item is disabled and the menu says why.
 */
function NewMenu() {
  const t = useTerminal();
  return (
    <Menu>
      <MenuTrigger render={<ActionButton aria-label="New terminal" disabled={t.creating} icon size="s" variant="quiet" />}>
        <PlusIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        {t.problem && (
          <MenuGroup>
            <MenuGroupLabel className="w-64 whitespace-normal" data-testid="terminal-menu-problem">{`The terminal cannot start: ${t.problem.reason}.`}</MenuGroupLabel>
          </MenuGroup>
        )}
        {!t.problem && (t.full || !t.project) && (
          <MenuGroup>
            <MenuGroupLabel className="w-64 whitespace-normal">{t.full ? "Eight terminals are running. Close one to start another." : "Claude Code and Codex start from a project's screen."}</MenuGroupLabel>
          </MenuGroup>
        )}
        {/* P64: the automatic start resumes the project's last session; every item here starts a NEW one. */}
        {!t.full && t.project && (
          <MenuGroup>
            <MenuGroupLabel>New session</MenuGroupLabel>
          </MenuGroup>
        )}
        {t.offered.map((p, i) => {
          const f = factOf(t.clis, p);
          const note = [f ? STATE_NOTE[f.state] : null, i === 0 && t.offered.length > 1 ? "default" : null].filter(Boolean).join(", ");
          return (
            <MenuItem disabled={t.problem !== null || t.full || f?.state === "missing"} key={p} onClick={() => t.create(p)}>
              {PRESET_LABELS[p]}
              {note && <span className="ms-auto ps-4 text-muted-foreground text-xs">{note}</span>}
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
}

/** One quiet line (P51): what "this draft" means to the agent right now, from the focus this tab published. Showing, not a control. */
function AgentSees() {
  const { published } = useSharedFocus();
  return (
    <p className="truncate px-3 pb-1.5 text-muted-foreground text-xs" data-testid="agent-sees">
      {agentSeesLine(published)}
    </p>
  );
}

/**
 * The one quiet line when the automatic start was not the first choice (P57 2i, 2k): which CLI started and why, ending in the
 * command that fixes it (" · claude auth login"), with a copy button. Never a dialog, never a toast only.
 */
function WhyLine({ why }: { why: string }) {
  const fix = why.includes(" · ") ? (why.split(" · ").at(-1) ?? null) : null;
  return (
    <div className="flex min-h-8 items-center gap-1 px-3 pb-1.5 text-muted-foreground text-xs" data-testid="terminal-why">
      <p className="min-w-0 flex-1 truncate" title={why}>{why}</p>
      {fix && <CopyFix fix={fix} />}
    </div>
  );
}

/** The copy button of a fix line (P57): the line goes to the clipboard, and the status says so for a screen reader. */
function CopyFix({ fix }: { fix: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <>
      <ActionButton aria-label={`Copy ${fix}`} icon onClick={() => void copyText(fix).then((ok) => setSaid(ok ? `Copied: ${fix}` : "The browser refused the clipboard: select the line and copy it."))} size="s" variant="quiet">
        <CopyIcon aria-hidden="true" />
      </ActionButton>
      <span className="sr-only" role="status">{said}</span>
    </>
  );
}

/**
 * Why no terminal tab can start on this Mac (P66): the reason, then the one line that fixes it, with the copy button. In
 * the column, never a dialog; the strip and the column stay drawn.
 */
export function ProblemLine({ problem }: { problem: TerminalProblemDto }) {
  return (
    <div className="measure flex flex-col gap-2 p-4 text-sm" data-testid="terminal-problem">
      <p>{`The terminal cannot start: ${problem.reason}.`}</p>
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="shrink-0">Fix:</span>
        <code className="min-w-0 flex-1 select-all break-all rounded-sm bg-muted px-1.5 py-0.5 text-xs">{problem.fix}</code>
        <CopyFix fix={problem.fix} />
      </div>
      <p className="text-muted-foreground text-xs">Then Refresh in Connections, Agent tools, or reload this page.</p>
    </div>
  );
}

/** Left and Right move between tabs (and open the one they land on), Home and End go to the ends: the tabs pattern. */
function onTabKeys(e: KeyboardEvent<HTMLDivElement>, ids: string[], active: string | null, pick: (id: string) => void) {
  const at = active ? ids.indexOf(active) : -1;
  const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? ids.length - 1 : null;
  if (to === null || ids.length === 0) return;
  e.preventDefault();
  const id = ids[(to + ids.length) % ids.length];
  if (!id) return;
  pick(id);
  document.getElementById(tabId(id))?.focus();
}

/**
 * The column's header: the tabs (one tab stop; Left and Right move), Open in Claude Desktop (P61 L5: disabled with its reason, not
 * offered), Close for the open tab (it ends the session), the `+`
 * menu, and Hide (the sessions keep running). In the narrow layer it is titled "Terminal". The agent mode is not shown here:
 * it is set in the config and shown in Connections, Agent tools.
 */
export function TerminalHeader({ layer }: { layer: boolean }) {
  const t = useTerminal();
  const sessions = t.state?.sessions ?? [];
  const current = sessions.find((s) => s.id === t.active);
  return (
    <div className="flex shrink-0 flex-col border-b">
      <div className="flex min-h-11 items-center gap-1 ps-2 pe-1">
        {layer && <h2 className="shrink-0 pe-2 font-heading font-semibold text-base">Terminal</h2>}
        <div aria-label="Terminal sessions" className="scroll-strip flex min-w-0 flex-1 items-center gap-0.5" onKeyDown={(e) => onTabKeys(e, sessions.map((s) => s.id), t.active, t.setActive)} role="tablist">
          {sessions.map((s) => {
            const on = s.id === t.active;
            return (
              <ActionButton aria-controls={panelId(s.id)} aria-selected={on} className={cn("max-w-[14rem] shrink-0 justify-start", on ? "bg-accent text-foreground" : "text-muted-foreground")} id={tabId(s.id)} key={s.id} onClick={() => t.setActive(s.id)} role="tab" size="s" tabIndex={on ? 0 : -1} variant="quiet">
                <span className="truncate">{tabTitle(s)}</span>
              </ActionButton>
            );
          })}
        </div>
        {current && <DesktopHandoffButton preset={current.preset} />}
        {current && (
          <ActionButton aria-label={`Close ${tabTitle(current)}`} disabled={t.closing === current.id} icon onClick={() => t.close(current.id)} size="s" variant="quiet">
            <XIcon aria-hidden="true" />
          </ActionButton>
        )}
        <NewMenu />
        <ActionButton aria-label="Hide the terminal" icon={!layer} onClick={() => t.setOpen(false)} size="s" variant="quiet">
          {layer ? "Hide" : <PanelRightCloseIcon aria-hidden="true" />}
        </ActionButton>
      </div>
      {t.why && <WhyLine why={t.why} />}
      {current && current.preset !== "shell" && <AgentSees />}
      {t.notice && (
        <p className="px-3 pb-2 text-destructive-foreground text-sm" role="alert">
          {t.notice}
        </p>
      )}
    </div>
  );
}
