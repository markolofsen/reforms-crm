"use client";

import { ChevronDownIcon } from "lucide-react";
import type { AgentToolRow } from "@hub/contract/agent-tools";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import { useSearch } from "@/hooks/use-search-state";
import { AGENT_SEARCH, AGENT_VIEWS, type AgentView } from "@/routes/search";
import { SettingsGroup } from "../group";
import { needsAttention } from "./labels";
import { ToolTable } from "./tool-table";

const VIEW_LABEL: Record<AgentView, string> = { attention: "Needs a look", all: "All" };

/** The View menu of the Tools table: which rows to show, each view with its count (`admin-principles.md` rule 11). */
function ViewMenu({ value, counts, onChange }: { value: AgentView; counts: Record<AgentView, number>; onChange: (v: string) => void }) {
  return (
    <Menu>
      <MenuTrigger render={<ActionButton size="m" variant="secondary" />}>
        <span className="sr-only">View: </span>
        {VIEW_LABEL[value]}
        <span className="font-normal tabular-nums">{counts[value]}</span>
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup onValueChange={(v) => onChange(String(v))} value={value}>
          {AGENT_VIEWS.map((v) => (
            <MenuRadioItem key={v} value={v}>
              {VIEW_LABEL[v]} <span className="ms-auto ps-3 text-muted-foreground tabular-nums">{counts[v]}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * Settings ▸ Agent ▸ Tools (P75): the checks of both agent CLIs in one table, each row naming its CLI, after the settings. By
 * default only the rows that need a fix or a look (each with its fix line and Copy); the View menu ("Needs a look", "All") filters
 * the same table and its choice lives in the address (`?filter=all`), so it survives a reload. Not a disclosure: the table, or
 * with nothing to look at its one line, is always drawn. It replaces the two "All checks" folds of P70.
 */
export function Tools({ rows, onCopy }: { rows: readonly AgentToolRow[]; onCopy: (fix: string) => void }) {
  const [{ filter: view }, setSearch] = useSearch(AGENT_SEARCH);
  const attention = rows.filter(needsAttention);
  const shown = view === "all" ? rows : attention;
  return (
    <SettingsGroup id="agent-tools" title="Tools">
      <div className="flex min-w-0 justify-end">
        <ViewMenu counts={{ attention: attention.length, all: rows.length }} onChange={(v) => setSearch({ filter: v })} value={view} />
      </div>
      {shown.length > 0 ? (
        <ToolTable onCopy={onCopy} rows={shown} title={view === "all" ? "Agent tools: all checks" : "Agent tools: needs a fix or a look"} />
      ) : (
        <p className="py-2 text-sm" data-testid="agent-tools-all-pass">
          All {rows.length} checks pass
        </p>
      )}
    </SettingsGroup>
  );
}
