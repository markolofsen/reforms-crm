"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { ActionButton } from "@hub/ui/product/action-button";
import { Skeleton } from "@hub/ui/skeleton";
import { LoadFailed } from "@/components/state-views";
import { connectionsApi } from "@/lib/api/connections";
import { sentence } from "@/lib/api/client";
import { useClock } from "@/lib/clock";
import { copyText } from "@/lib/external";
import { ago } from "@/lib/format";
import { useAgentTools } from "@/lib/status";
import { CLI_TITLE, columns, needsAttention, toolsSentence } from "./labels";
import { ToolTable } from "./tool-table";
import { keys } from "@/lib/cache/keys";

type Say = { text: string; kind: "status" | "alert" } | null;

/**
 * One project's Agent tools, the body of Settings ▸ Agent (P70; P63's Agents page, on Connections before that): whether a hub session of Claude
 * Code and of Codex has what it needs (P49 section 5B: the CLIs, P57, the MCP rows, Send tools off, the skills), as the server
 * last checked it. The status line and Refresh, then only the rows that need a fix or a look (each with its fix line and Copy),
 * then every check, one table per CLI, folded under "All checks" like Overview's "All parts" (UX pass 2026-11-20: thirty green
 * rows and their paths are reassurance, not news). Read-only but for Refresh (the checks run again, about 10 s) and Copy; one
 * live region says what Refresh and Copy did.
 */
export function AgentTools({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const now = useClock()();
  const q = useAgentTools(slug);
  const [say, setSay] = useState<Say>(null);
  const refresh = useMutation({
    mutationFn: () => connectionsApi.refreshAgentTools(slug),
    onMutate: () => setSay({ text: "Checking the agent tools...", kind: "status" }),
    onSuccess: (d) => {
      qc.setQueryData(keys.agentTools(slug), d);
      // Overview's parts read the same cache on the server (P63 O1): the refresh bumps no live topic, so this tab reads them again.
      void qc.invalidateQueries({ queryKey: keys.scheme() });
      setSay({ text: "Checked again.", kind: "status" });
    },
    onError: (e) => setSay({ text: `Could not check again: ${sentence(e)}`, kind: "alert" }),
  });
  const copy = (fix: string) => void copyText(fix).then((ok) => setSay(ok ? { text: `Copied: ${fix}`, kind: "status" } : { text: "The browser refused the clipboard: select the line and copy it.", kind: "alert" }));
  const d = q.data;
  const id = `agent-tools-${slug}`;
  const attention = d ? d.rows.filter(needsAttention) : [];
  return (
    <section aria-label="Agent tools" className="flex flex-col gap-3">
      {q.isPending ? (
        <Skeleton aria-label="Loading the agent tools" className="h-24 w-full rounded-xl" role="status" />
      ) : !d ? (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the agent tools" />
      ) : (
        <div className="flex min-w-0 flex-col gap-3" data-testid={id}>
          <div className="flex min-h-(--control-m) min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <p className="min-w-0 flex-1 font-medium text-base" data-testid="agent-tools-status" role="status">
              {toolsSentence(d)}
              {d.checkedAt && <span className="font-normal text-muted-foreground text-sm"> · checked {ago(d.checkedAt, now)}</span>}
            </p>
            <ActionButton aria-busy={refresh.isPending} disabled={refresh.isPending} onClick={() => refresh.mutate()} size="m" variant="secondary">
              <RefreshCwIcon aria-hidden="true" />
              {refresh.isPending ? "Checking..." : "Refresh"}
            </ActionButton>
          </div>
          {attention.length > 0 && <ToolTable mixed onCopy={copy} rows={attention} title="Needs a fix or a look" />}
          <Collapsible>
            <CollapsibleTrigger className="group -ms-3 justify-start gap-2" render={<ActionButton size="m" variant="quiet" />}>
              All checks
              <span className="font-normal text-muted-foreground tabular-nums">{d.rows.length}</span>
              <ChevronDownIcon aria-hidden="true" className="transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none" />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="@container pt-2">
                <div className="grid gap-4 @3xl:grid-cols-2">
                  {columns(d.rows).map((c) => c.rows.length > 0 && <ToolTable key={c.cli} onCopy={copy} rows={c.rows} title={CLI_TITLE[c.cli]} />)}
                </div>
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      )}
      <div className="min-h-5 text-sm">
        <p role="status">{say?.kind === "status" ? say.text : ""}</p>
        <p className="text-destructive-foreground" role="alert">
          {say?.kind === "alert" ? say.text : ""}
        </p>
      </div>
    </section>
  );
}
