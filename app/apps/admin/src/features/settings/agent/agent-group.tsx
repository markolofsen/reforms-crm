"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ADVISOR_MODELS, AGENT_MODELS, MODEL_LABELS, type AgentSettings } from "@hub/config";
import { Radio, RadioGroup } from "@hub/ui/radio-group";
import { Skeleton } from "@hub/ui/skeleton";
import { Switch } from "@hub/ui/switch";
import { LoadFailed } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { useCommand } from "@/lib/cache/topics";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";

type Say = { text: string; kind: "status" | "alert" } | null;

/** One setting: its name and control on one line (the label is the 44 px touch target below 1024 px), its hint under it. */
function Row({ id, label, hint, children }: { id: string; label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-2" data-testid={`agent-${id}`}>
      <div className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 lg:min-h-(--control-m)">
        <span className="min-w-0 font-medium text-sm" id={`agent-${id}-label`}>
          {label}
        </span>
        {children}
      </div>
      <p className="text-muted-foreground text-sm">{hint}</p>
    </div>
  );
}

/** Two named choices, one picked: radios in one line, each label a 44 px target below 1024 px (as Stop sending's). */
function Choice<T extends keyof typeof MODEL_LABELS>({ id, options, value, disabled, onChange }: { id: string; options: readonly T[]; value: T; disabled: boolean; onChange: (v: T) => void }) {
  return (
    <RadioGroup aria-labelledby={`agent-${id}-label`} className="flex flex-row gap-4" disabled={disabled} onValueChange={(v) => { const picked = options.find((o) => o === v); if (picked && picked !== value) onChange(picked); }} value={value}>
      {options.map((o) => (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm lg:min-h-0" htmlFor={`agent-${id}-${o}`} key={o}>
          <Radio id={`agent-${id}-${o}`} value={o} />
          {MODEL_LABELS[o]}
        </label>
      ))}
    </RadioGroup>
  );
}

/**
 * Settings ▸ Agent, the Claude Code group's settings (P55): the model of this project's Claude Code sessions and its advisor.
 * Stored with the safety rules (the database), written into the session's settings.json by `hub agent` at the next start; a
 * running session is never restarted (the pane's first line says so). Codex has no settings here: its group says why.
 */
export function ClaudeSettings({ project }: { project: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.agentSettings(project), queryFn: () => metaApi.agentSettings(project) });
  const [say, setSay] = useState<Say>(null);
  const save = useCommand({
    project,
    touches: ["rules"],
    run: (patch: Partial<AgentSettings>) => metaApi.setAgentSettings(project, patch),
    onSuccess: (d) => {
      qc.setQueryData(keys.agentSettings(project), d);
      setSay({ text: "Saved: applies to the next agent session.", kind: "status" });
    },
    onError: (e) => setSay({ text: `Not saved: ${sentence(e)}`, kind: "alert" }),
  });
  const a = q.data?.agent;
  const busy = save.isPending;
  return (
    <div className="flex flex-col">
      {q.isPending ? (
        <Skeleton aria-label="Loading the agent settings" className="h-24 w-full rounded-xl" role="status" />
      ) : !a ? (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the agent settings" />
      ) : (
        <div className="flex flex-col divide-y" data-testid="agent-settings">
          <Row hint="Sonnet suits draft work; Opus takes longer over hard mail." id="model" label="Model">
            <Choice disabled={busy} id="model" onChange={(model) => save.mutate({ model })} options={AGENT_MODELS} value={a.model} />
          </Row>
          <Row hint="The advisor re-reads the whole session on each call: use it for long sessions with real decisions." id="advisor" label="Advisor">
            <label className="flex min-h-11 cursor-pointer items-center lg:min-h-0" htmlFor="agent-advisor-switch">
              <Switch aria-labelledby="agent-advisor-label" checked={a.advisor} disabled={busy} id="agent-advisor-switch" onCheckedChange={(advisor) => save.mutate({ advisor })} />
            </label>
          </Row>
          {a.advisor && (
            <Row hint="The model the agent consults before a hard step." id="advisor-model" label="Advisor model">
              <Choice disabled={busy} id="advisor-model" onChange={(advisorModel) => save.mutate({ advisorModel })} options={ADVISOR_MODELS} value={a.advisorModel} />
            </Row>
          )}
        </div>
      )}
      <div className="min-h-5 text-sm">
        <p role="status">{say?.kind === "status" ? say.text : ""}</p>
        <p className="text-destructive-foreground" role="alert">
          {say?.kind === "alert" ? say.text : ""}
        </p>
      </div>
    </div>
  );
}
