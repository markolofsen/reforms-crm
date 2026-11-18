import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SAFETY_LABELS } from "@hub/config";
import type { SafetyRuleDto } from "@hub/contract/responses";
import { Badge } from "@hub/ui/badge";
import { Input } from "@hub/ui/input";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { Switch } from "@hub/ui/switch";
import { refreshData, sentence } from "@/lib/api/client";
import { metaApi } from "@/lib/api/meta";
import { FactLine } from "./fact-line";

type Patch = { enabled?: boolean; params?: { words?: string[]; days?: number } };

/** The words or the days of a rule that has them, inline in its row; saved when the field is left. */
function Params({ rule, save }: { rule: SafetyRuleDto; save: (p: Patch) => void }) {
  const [words, setWords] = useState((rule.params.words ?? []).join(", "));
  const [days, setDays] = useState(String(rule.params.days ?? ""));
  if (rule.kind === "risky_word") {
    return <Input aria-label="Risky words, separated by commas" className="control-m" onBlur={() => save({ params: { words: words.split(",").map((w) => w.trim()).filter(Boolean) } })} onChange={(e) => setWords(e.target.value)} value={words} />;
  }
  if (rule.kind === "already_sent_recently") {
    return (
      <label className="flex items-center gap-2" htmlFor="rule-days">
        Within
        <Input className="control-m w-20" id="rule-days" inputMode="numeric" onBlur={() => Number(days) >= 1 && save({ params: { days: Math.round(Number(days)) } })} onChange={(e) => setDays(e.target.value)} value={days} />
        days
      </label>
    );
  }
  return null;
}

function RuleRow({ project, rule }: { project: string; rule: SafetyRuleDto }) {
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: (patch: Patch) => metaApi.setRule(project, rule.kind, patch), onSuccess: () => refreshData(qc) });
  const label = SAFETY_LABELS[rule.kind];
  return (
    <TableRow data-rule={rule.kind}>
      <TableCell>
        <div className="flex min-w-0 flex-col gap-1.5 py-1">
          <span>{label}</span>
          <Params rule={rule} save={(p) => save.mutate(p)} />
          {save.isError && (
            <span className="text-destructive-foreground text-xs" role="alert">
              {sentence(save.error)}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={rule.level === "red" ? "error" : "warning"}>{rule.level === "red" ? "Red" : "Amber"}</Badge>
      </TableCell>
      <TableCell>
        {/* The label is the touch target: 44px high below 1024px, the switch alone is smaller. */}
        <label className="flex min-h-11 cursor-pointer items-center lg:min-h-0" htmlFor={`rule-${rule.kind}`}>
          <Switch aria-label={label} checked={rule.enabled} disabled={save.isPending} id={`rule-${rule.kind}`} onCheckedChange={(v) => save.mutate({ enabled: v })} />
          <span className="sr-only">{label}</span>
        </label>
      </TableCell>
    </TableRow>
  );
}

/** "Safety rules: all 18 on" or "Safety rules: 17 of 18 on, Risky words is off". */
export function rulesSummary(list: readonly SafetyRuleDto[]): string {
  const off = list.filter((r) => !r.enabled);
  if (off.length === 0) return `Safety rules: all ${list.length} on`;
  const names = off.length <= 2 ? `, ${off.map((r) => SAFETY_LABELS[r.kind]).join(" and ")} ${off.length === 1 ? "is" : "are"} off` : "";
  return `Safety rules: ${list.length - off.length} of ${list.length} on${names}`;
}

/**
 * Advanced: the safety rules (a rule that fires must be understood before a draft can be sent), rarely changed, so the
 * line is closed with a summary and opens by itself when a rule is off (`admin-principles.md` rule 9).
 */
export function SafetyRules({ project }: { project: string }) {
  const q = useQuery({ queryKey: ["rules", project], queryFn: () => metaApi.rules(project) });
  if (!q.data) return <FactLine summary={q.isError ? `Could not be read: ${sentence(q.error)}` : "Reading..."} title="Advanced" tone={q.isError ? "problem" : "plain"} />;
  const { rules } = q.data;
  const anyOff = rules.some((r) => !r.enabled);
  return (
    <FactLine open={anyOff} summary={rulesSummary(rules)} title="Advanced" tone={anyOff ? "problem" : "plain"}>
      <DataTable aria-label="Safety rules">
        <TableHeader>
          <TableRow>
            <TableHead>Rule</TableHead>
            <TableHead className="w-1/5">Level</TableHead>
            <TableHead className="w-1/5">On</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((r) => (
            <RuleRow key={`${r.kind}:${r.enabled}:${JSON.stringify(r.params)}`} project={project} rule={r} />
          ))}
        </TableBody>
      </DataTable>
    </FactLine>
  );
}
