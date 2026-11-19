"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Skeleton } from "@hub/ui/skeleton";
import { LoadFailed } from "@/components/state-views";
import { connectionsApi } from "@/lib/api/connections";
import { sentence } from "@/lib/api/client";
import { useClock } from "@/lib/clock";
import { copyText } from "@/lib/external";
import { ago } from "@/lib/format";
import { useAgentTools } from "@/lib/status";
import { CLI_TITLE, columns, toolsSentence } from "./labels";
import { ToolTable } from "./tool-table";
import { keys } from "@/lib/cache/keys";

type Say = { text: string; kind: "status" | "alert" } | null;

/**
 * One project's Agent tools, the body of Settings ▸ Agent (P70; P63's Agents page, on Connections before that): whether a hub session of Claude
 * Code and of Codex has what it needs (P49 section 5B: the CLIs, P57, the MCP rows, Send tools off, the skills), as the server
 * last checked it, one table per CLI. Read-only but for Refresh (the checks run again, about 10 s) and the copy of a red row's
 * fix line. One status line says where it stands; one live region says what Refresh and Copy did.
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
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-1">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide" id={`${id}-title`}>
        Agent tools
      </h3>
      {q.isPending ? (
        <Skeleton aria-label="Loading the agent tools" className="h-24 w-full rounded-xl" role="status" />
      ) : !d ? (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the agent tools" />
      ) : (
        <div className="flex min-w-0 flex-col gap-3" data-testid={id}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <p className="min-w-0 flex-1 text-sm" data-testid="agent-tools-status">
              {toolsSentence(d)}
              {d.checkedAt && <span className="text-muted-foreground"> · checked {ago(d.checkedAt, now)}</span>}
            </p>
            <ActionButton aria-busy={refresh.isPending} disabled={refresh.isPending} onClick={() => refresh.mutate()} size="s" variant="secondary">
              <RefreshCwIcon aria-hidden="true" />
              {refresh.isPending ? "Checking..." : "Refresh"}
            </ActionButton>
          </div>
          <div className="@container">
            <div className="grid gap-4 @3xl:grid-cols-2">
              {columns(d.rows).map((c) => c.rows.length > 0 && <ToolTable key={c.cli} onCopy={copy} rows={c.rows} title={CLI_TITLE[c.cli]} />)}
            </div>
          </div>
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
