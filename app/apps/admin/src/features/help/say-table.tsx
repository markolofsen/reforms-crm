import { SAY, sayFor } from "@hub/contract/help";
import { SectionTitle } from "@hub/ui/product/shell/page";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";
import { useProjectScope } from "@/hooks/use-project";

/**
 * What to say to the agent (P63 O3): one row per phrase, most used first, from `@hub/contract/help` (the skills README's own
 * examples in English, held equal by a docs test; P81). `X` is shown as this project's name. A phrase is one way to say it: the agent picks the
 * skill by what he wants. From 768px a table, below it two lines a phrase.
 */
export function SayTable() {
  const { project } = useProjectScope();
  const rows = SAY.map((s) => ({ ...s, say: sayFor(s.example, project) }));
  return (
    <section aria-labelledby="help-say" className="flex min-w-0 flex-col gap-1" data-testid="help-say">
      <SectionTitle id="help-say">What to say to the agent</SectionTitle>
      <p className="measure text-muted-foreground">In the terminal on the right, in your own words and in any language; these are examples.</p>
      <DataTable aria-labelledby="help-say" className="max-md:hidden">
        <TableHeader>
          <TableRow>
            <TableHead className="w-2/5">Say</TableHead>
            <TableHead>What happens</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow data-skill={r.skill} key={r.example}>
              <TableCell className="font-medium">{r.say}</TableCell>
              <TableCell className="text-muted-foreground">{r.what}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
      <ul aria-labelledby="help-say" className="flex flex-col divide-y border-y md:hidden">
        {rows.map((r) => (
          <li className="flex min-w-0 flex-col gap-0.5 py-2" data-skill={r.skill} key={r.example}>
            <span className="font-medium">{r.say}</span>
            <span className="text-muted-foreground text-xs">{r.what}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
