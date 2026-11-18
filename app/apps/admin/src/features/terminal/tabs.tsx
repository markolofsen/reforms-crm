"use client";

import { PanelRightCloseIcon, PlusIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { PRESET_LABELS, type TerminalSessionDto } from "@hub/contract/terminal";
import { Badge } from "@hub/ui/badge";
import { cn } from "@hub/ui/cn";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import { panelId, tabId } from "./session";
import { useTerminal } from "./use-terminal";

/** A tab's name: the session's title, with the project's slug when the title does not carry it, and the exit code once it ended. */
export function tabTitle(s: TerminalSessionDto): string {
  const title = s.project && !s.title.includes(s.project) ? `${s.title} · ${s.project}` : s.title;
  return s.state === "exited" ? `${title} (exit ${s.exitCode ?? "?"})` : title;
}

/** The `+` menu: the presets the server offers here, in its order; the first is the default. Without a project, only Shell. */
function NewMenu() {
  const t = useTerminal();
  return (
    <Menu>
      <MenuTrigger render={<ActionButton aria-label="New terminal" disabled={t.creating} icon size="s" variant="quiet" />}>
        <PlusIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        {(t.full || !t.project) && (
          <MenuGroup>
            <MenuGroupLabel className="w-64 whitespace-normal">{t.full ? "Eight terminals are running. Close one to start another." : "Claude Code and Codex start from a project's screen."}</MenuGroupLabel>
          </MenuGroup>
        )}
        {t.offered.map((p, i) => (
          <MenuItem disabled={t.full} key={p} onClick={() => t.create(p)}>
            {PRESET_LABELS[p]}
            {i === 0 && t.offered.length > 1 && <span className="ms-auto ps-4 text-muted-foreground text-xs">default</span>}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
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
 * The column's header: the tabs (one tab stop; Left and Right move), Close for the open tab (it ends the session), the mode
 * badge for an agent tab of an unattended instance, the `+` menu, and Hide (the sessions keep running). In the narrow layer
 * it is titled "Terminal".
 */
export function TerminalHeader({ layer }: { layer: boolean }) {
  const t = useTerminal();
  const sessions = t.state?.sessions ?? [];
  const current = sessions.find((s) => s.id === t.active);
  const sandboxed = t.state?.unattended === true && current !== undefined && current.preset !== "shell";
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
        {current && (
          <ActionButton aria-label={`Close ${tabTitle(current)}`} disabled={t.closing === current.id} icon onClick={() => t.close(current.id)} size="s" variant="quiet">
            <XIcon aria-hidden="true" />
          </ActionButton>
        )}
        {sandboxed && (
          <Badge className="shrink-0" variant="info">
            <ShieldCheckIcon aria-hidden="true" />
            {/* The narrow layer keeps Hide on screen: the words stay for a screen reader, the shield for the eye. */}
            <span className={layer ? "sr-only" : undefined}>unattended, sandboxed</span>
          </Badge>
        )}
        <NewMenu />
        <ActionButton aria-label="Hide the terminal" icon={!layer} onClick={() => t.setOpen(false)} size="s" variant="quiet">
          {layer ? "Hide" : <PanelRightCloseIcon aria-hidden="true" />}
        </ActionButton>
      </div>
      {t.notice && (
        <p className="px-3 pb-2 text-destructive-foreground text-sm" role="alert">
          {t.notice}
        </p>
      )}
    </div>
  );
}
