import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SAFETY_LABELS } from "@hub/config";
import type { SafetyRuleDto } from "@hub/contract/responses";
import { LoadFailed, Loading } from "@/components/state-views";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { refreshData, sentence } from "@/lib/api/client";
import { metaApi } from "@/lib/api/meta";

function RuleRow({ project, rule }: { project: string; rule: SafetyRuleDto }) {
  const qc = useQueryClient();
  const [words, setWords] = useState((rule.params.words ?? []).join(", "));
  const [days, setDays] = useState(String(rule.params.days ?? ""));
  const save = useMutation({
    mutationFn: (patch: { enabled?: boolean; params?: { words?: string[]; days?: number } }) => metaApi.setRule(project, rule.kind, patch),
    onSuccess: () => refreshData(qc),
  });
  const id = `rule-${rule.kind}`;
  return (
    <li className="flex min-w-0 flex-col gap-2 py-2">
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 lg:min-h-0" htmlFor={id}>
        <Switch checked={rule.enabled} disabled={save.isPending} id={id} onCheckedChange={(v) => save.mutate({ enabled: v })} />
        <span className="font-medium text-sm">{SAFETY_LABELS[rule.kind]}</span>
        <Badge variant={rule.level === "red" ? "error" : "warning"}>{rule.level === "red" ? "Red" : "Amber"}</Badge>
        <span className="text-muted-foreground text-xs">{rule.enabled ? "On" : "Off"}</span>
      </label>
      {rule.kind === "risky_word" && (
        <Input aria-label="Risky words, separated by commas" className="control-m" onBlur={() => save.mutate({ params: { words: words.split(",").map((w) => w.trim()).filter(Boolean) } })} onChange={(e) => setWords(e.target.value)} value={words} />
      )}
      {rule.kind === "already_sent_recently" && (
        <label className="flex items-center gap-2 text-sm" htmlFor={`${id}-days`}>
          Within
          <Input aria-label="Days" id={`${id}-days`} className="w-20 control-m" inputMode="numeric" onBlur={() => Number(days) >= 1 && save.mutate({ params: { days: Math.round(Number(days)) } })} onChange={(e) => setDays(e.target.value)} value={days} />
          days
        </label>
      )}
      {save.isError && (
        <p className="text-destructive-foreground text-xs" role="alert">
          {sentence(save.error)}
        </p>
      )}
    </li>
  );
}

/** The safety rules of a project: a rule that fires must be acknowledged before a draft can be sent. */
export function SafetyRules({ project }: { project: string }) {
  const q = useQuery({ queryKey: ["rules", project], queryFn: () => metaApi.rules(project) });
  if (q.isPending) return <Loading what="the safety rules" />;
  if (q.isError) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the safety rules" />;
  return (
    <ul className="divide-y">
      {q.data.rules.map((r) => (
        <RuleRow key={`${r.kind}:${r.enabled}:${JSON.stringify(r.params)}`} project={project} rule={r} />
      ))}
    </ul>
  );
}
