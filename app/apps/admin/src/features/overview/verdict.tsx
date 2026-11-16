import type { VerdictDto } from "@hub/contract/overview";
import { VERDICT } from "./labels";

/** The one sentence of the page: icon and word first, then what the server derived. */
export function Verdict({ verdict }: { verdict: VerdictDto }) {
  const { word, Icon, tone } = VERDICT[verdict.level];
  return (
    <section aria-label="Verdict" className="flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4">
      <Icon aria-hidden="true" className={`mt-0.5 size-6 shrink-0 ${tone}`} />
      <div className="min-w-0">
        <p className="font-heading font-medium text-lg leading-snug">{word}</p>
        <p className="break-words text-muted-foreground text-sm">{verdict.headline}</p>
      </div>
    </section>
  );
}
