import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SAFETY_LABELS } from "@hub/config";
import type { SafetyRuleDto } from "@hub/contract/responses";
import { Input } from "@hub/ui/input";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { Skeleton } from "@hub/ui/skeleton";
import { Switch } from "@hub/ui/switch";
import { QueryView } from "@/components/state-views";
import { refreshData, sentence } from "@/lib/api/client";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";

/** The two groups of the table, in this order (P75): what a level does, said once as a heading instead of a badge on every row. */
const LEVELS: readonly { level: SafetyRuleDto["level"]; title: string }[] = [
  { level: "red", title: "Blocks Send" },
  { level: "amber", title: "Warns" },
];

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
        {/* The label is the touch target: 44px high below 1024px, the switch alone is smaller. */}
        <label className="flex min-h-11 cursor-pointer items-center lg:min-h-0" htmlFor={`rule-${rule.kind}`}>
          <Switch aria-label={label} checked={rule.enabled} disabled={save.isPending} id={`rule-${rule.kind}`} onCheckedChange={(v) => save.mutate({ enabled: v })} />
          <span className="sr-only">{label}</span>
        </label>
      </TableCell>
    </TableRow>
  );
}

/** "All 19 on" or "18 of 19 on, Risky words is off" (the off rules named, at most two). */
export function rulesSummary(list: readonly SafetyRuleDto[]): string {
  const off = list.filter((r) => !r.enabled);
  if (off.length === 0) return `All ${list.length} on`;
  const names = off.length <= 2 ? `, ${off.map((r) => SAFETY_LABELS[r.kind]).join(" and ")} ${off.length === 1 ? "is" : "are"} off` : "";
  return `${list.length - off.length} of ${list.length} on${names}`;
}

/**
 * Settings ▸ Checks (P75; folded inside Sending as "Checks before sending" until then): the safety rules that decide whether a
 * draft may be sent. One sentence that names a rule set off, then every rule in view, grouped "Blocks Send" then "Warns" (a group
 * heading is a row, never a disclosure or a tab stop), each with its switch and its words or days inline. Nothing is folded: a
 * pane whose content is its list of controls shows the list (`admin-principles.md` rule 9).
 */
export function ChecksPane({ project }: { project: string }) {
  const q = useQuery({ queryKey: keys.rules(project), queryFn: () => metaApi.rules(project) });
  // P127 B1: a failed refetch keeps the rules on screen under the stale note.
  return (
    <QueryView loading={<Skeleton aria-label="Loading the checks" className="h-24 w-full rounded-xl" role="status" />} query={q} what="the checks before sending">
      {(data) => <Checks project={project} rules={data.rules} />}
    </QueryView>
  );
}

function Checks({ project, rules }: { project: string; rules: SafetyRuleDto[] }) {
  const anyOff = rules.some((r) => !r.enabled);
  return (
    <>
      <p className={anyOff ? "font-medium text-base text-warning-foreground" : "font-medium text-base"} data-testid="checks-status" role="status">
        {rulesSummary(rules)}
      </p>
      <DataTable aria-label="Checks before sending">
        <TableHeader>
          <TableRow>
            <TableHead>Rule</TableHead>
            <TableHead className="w-1/5">On</TableHead>
          </TableRow>
        </TableHeader>
        {LEVELS.map(({ level, title }) => {
          const group = rules.filter((r) => r.level === level);
          if (group.length === 0) return null;
          return (
            <TableBody data-level={level} key={level}>
              <TableRow data-level-head="">
                <TableHead className="whitespace-normal bg-muted/40" colSpan={2} scope="colgroup">
                  {title} <span className="font-normal text-muted-foreground tabular-nums">{group.length}</span>
                </TableHead>
              </TableRow>
              {group.map((r) => (
                <RuleRow key={`${r.kind}:${r.enabled}:${JSON.stringify(r.params)}`} project={project} rule={r} />
              ))}
            </TableBody>
          );
        })}
      </DataTable>
    </>
  );
}
