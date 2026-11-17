import type { VerdictDto } from "@hub/contract/overview";
import { headline, VERDICT } from "./labels";

/**
 * The one sentence of the page: icon and word first, then how many things need the owner. The list under it names them, so
 * the server's headline (which quotes the first three) is shown only for "All clear" (rubric 2: say it once).
 */
export function Verdict({ verdict, need }: { verdict: VerdictDto; need: number }) {
  const { word, Icon, tone } = VERDICT[verdict.level];
  return (
    <section aria-label="Verdict" className="flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4">
      <Icon aria-hidden="true" className={`mt-0.5 size-6 shrink-0 ${tone}`} />
      <div className="min-w-0">
        <p className="font-heading font-medium text-lg leading-snug">{word}</p>
        <p className="break-words text-muted-foreground text-sm">{verdict.level === "clear" ? verdict.headline : headline(need)}</p>
      </div>
    </section>
  );
}
