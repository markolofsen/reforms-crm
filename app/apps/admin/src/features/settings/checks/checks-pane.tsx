import { SAFETY_LABELS } from "@hub/config";
import type { SafetyRuleDto } from "@hub/contract/settings";
import { CommitField, SettingSwitch } from "@hub/ui/product/field";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";
import { Skeleton } from "@hub/ui/skeleton";
import { QueryView } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { useRules, useSaveRule } from "@/lib/data/project";

/** The two groups of the table, in this order (P75): what a level does, said once as a heading instead of a badge on every row. */
const LEVELS: readonly { level: SafetyRuleDto["level"]; title: string }[] = [
  { level: "red", title: "Blocks Send" },
  { level: "amber", title: "Warns" },
];

type Patch = { enabled?: boolean; params?: { words?: string[]; days?: number } };

/** The words or the days of a rule that has them, inline in its row; saved when the field is left or Enter is pressed (`CommitField`). */
function Params({ rule, save, pending }: { rule: SafetyRuleDto; save: (p: Patch) => void; pending: boolean }) {
  if (rule.kind === "risky_word") {
    const words = (rule.params.words ?? []).join(", ");
    return <CommitField id={`rule-${rule.kind}-words`} key={words} label="Risky words, separated by commas" onCommit={(v) => save({ params: { words: v.split(",").map((w) => w.trim()).filter(Boolean) } })} pending={pending} value={words} />;
  }
  if (rule.kind === "already_sent_recently") {
    const days = String(rule.params.days ?? "");
    return (
      <label className="flex items-center gap-2" htmlFor="rule-days">
        Within
        <CommitField
          className="w-20"
          id="rule-days"
          inputMode="numeric"
          key={days}
          onCommit={(v) => {
            if (!(Number(v) >= 1)) return false;
            save({ params: { days: Math.round(Number(v)) } });
          }}
          pending={pending}
          value={days}
        />
        days
      </label>
    );
  }
  return null;
}

function RuleRow({ project, rule }: { project: string; rule: SafetyRuleDto }) {
  const save = useSaveRule(project, rule.kind);
  const label = SAFETY_LABELS[rule.kind];
  return (
    <TableRow data-rule={rule.kind}>
      <TableCell>
        <div className="flex min-w-0 flex-col gap-1.5 py-1">
          <span>{label}</span>
          <Params pending={save.isPending} rule={rule} save={(p) => save.mutate(p)} />
          {save.isError && (
            <span className="text-destructive-foreground text-xs" role="alert">
              {sentence(save.error)}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <SettingSwitch checked={rule.enabled} id={`rule-${rule.kind}`} label={label} onChange={(v) => save.mutate({ enabled: v })} pending={save.isPending} />
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
  const q = useRules(project);
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
