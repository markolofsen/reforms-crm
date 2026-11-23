"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Skeleton } from "@hub/ui/skeleton";
import { QueryView } from "@/components/state-views";
import { connectionsApi } from "@/lib/api/connections";
import { sentence } from "@/lib/api/client";
import { useClock } from "@/lib/clock";
import { copyText } from "@/lib/external";
import { ago } from "@/lib/format";
import { useAgentTools } from "@/lib/status";
import { AGENT_TOOL_CLIS } from "@hub/contract/agent-tools";
import { SettingsGroup } from "../group";
import { ClaudeSettings } from "./agent-group";
import { Connectors } from "./connectors";
import { CLI_TITLE, toolsSentence } from "./labels";
import { Tools } from "./tools";
import { keys } from "@/lib/cache/keys";

type Say = { text: string; kind: "status" | "alert" } | null;

/** What each agent's group holds: Claude Code's settings and connectors; Codex has neither here, so one line says so. */
const CLI_BODY: Record<(typeof AGENT_TOOL_CLIS)[number], (slug: string) => ReactNode> = {
  claude: (slug) => (
    <>
      <ClaudeSettings project={slug} />
      <Connectors slug={slug} />
    </>
  ),
  codex: () => (
    <p className="py-2 text-muted-foreground text-sm" data-testid="agent-codex">
      Uses its own default model; no advisor, no Google connectors.
    </p>
  ),
};

/**
 * Settings ▸ Agent (P55, P62, P49 section 5B), one group per agent CLI so nothing of one is read as the other's (owner,
 * 2026-11-20: "everything is mixed, Claude and the rest"). On top, the one status line for both and Refresh (the checks run
 * again, about 10 s). Then Claude Code: its model and advisor, its connectors; then Codex: one line. Then Tools (P75): the
 * diagnostics of both in one table, after the settings the owner decides, filtered by its View menu. Read-only but for the
 * settings, Refresh, the view and Copy; one live region says what Refresh and Copy did.
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
  return (
    <div className="flex flex-col gap-6" data-testid={`agent-tools-${slug}`}>
      <div className="flex min-h-(--control-m) min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <QueryView loading={<Skeleton aria-label="Loading the agent checks" className="h-6 w-64 rounded-md" role="status" />} query={q} what="the agent checks">
          {(d) => (
          <>
            <p className="min-w-0 flex-1 font-medium text-base" data-testid="agent-tools-status" role="status">
              {toolsSentence(d)}
              {d.checkedAt && <span className="font-normal text-muted-foreground text-sm"> · checked {ago(d.checkedAt, now)}</span>}
              <span className="block font-normal text-muted-foreground text-sm">Settings apply to the next agent session.</span>
            </p>
            <ActionButton aria-busy={refresh.isPending} disabled={refresh.isPending} onClick={() => refresh.mutate()} size="m" variant="secondary">
              <RefreshCwIcon aria-hidden="true" />
              {refresh.isPending ? "Checking..." : "Refresh"}
            </ActionButton>
          </>
          )}
        </QueryView>
      </div>
      {AGENT_TOOL_CLIS.map((cli) => (
        <SettingsGroup id={`agent-${cli}`} key={cli} title={CLI_TITLE[cli]}>
          {CLI_BODY[cli](slug)}
        </SettingsGroup>
      ))}
      {q.data && q.data.rows.length > 0 && <Tools onCopy={copy} rows={q.data.rows} />}
      <div className="min-h-5 text-sm">
        <p role="status">{say?.kind === "status" ? say.text : ""}</p>
        <p className="text-destructive-foreground" role="alert">
          {say?.kind === "alert" ? say.text : ""}
        </p>
      </div>
    </div>
  );
}
