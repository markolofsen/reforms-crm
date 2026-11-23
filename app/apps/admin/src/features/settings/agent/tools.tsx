"use client";

import type { AgentToolRow } from "@hub/contract/agent-tools";
import { ListFilterMenu } from "@hub/ui/product/list-toolbar";
import { useSearch } from "@/hooks/use-search-state";
import { AGENT_SEARCH, AGENT_VIEWS, type AgentView } from "@/routes/search";
import { SettingsGroup } from "../group";
import { needsAttention } from "./labels";
import { ToolTable } from "./tool-table";

/** The View menu of the Tools table is the lists' `ListFilterMenu` (P127 B1): each view with its count (`admin-principles.md` rule 11). */
const VIEW_LABEL: Record<AgentView, string> = { attention: "Needs a look", all: "All" };

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
        <ListFilterMenu
          name="View"
          onChange={(v) => setSearch({ filter: v })}
          options={AGENT_VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v], count: v === "all" ? rows.length : attention.length }))}
          tooltip="Filter the checks"
          value={view}
        />
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
