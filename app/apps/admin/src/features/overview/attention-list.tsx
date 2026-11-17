import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { AttentionItem } from "@hub/contract/overview";
import { ActionButton } from "@hub/ui/product/action-button";
import { AppLink } from "@/components/app-link";
import { attentionTarget, SEVERITY } from "./labels";

const SHOWN = 5;

/** "Needs you": the derived items, five at first. Each row is one link whose text is the sentence the server wrote. */
export function AttentionList({ items }: { items: readonly AttentionItem[] }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <section aria-labelledby="needs-you" className="flex flex-col gap-2">
      <h3 className="font-heading font-medium text-sm" id="needs-you">
        Needs you
      </h3>
      <ul aria-label="Needs you" className="divide-y rounded-xl border bg-card">
        {shown.map((item) => {
          const { word, Icon, tone } = SEVERITY[item.severity];
          const { to, project } = attentionTarget(item);
          return (
            <li className="min-w-0" key={`${item.kind}:${item.project ?? "-"}`}>
              <AppLink bare className="flex min-h-14 min-w-0 items-start gap-3 rounded-xl px-3 py-2.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" inProject={project} to={to}>
                <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${tone}`} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={`font-medium text-xs ${tone}`}>{word}</span>
                  <span className="break-words text-sm">{item.sentence}</span>
                </span>
                <ChevronRightIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </AppLink>
            </li>
          );
        })}
      </ul>
      {items.length > SHOWN && (
        <div>
          <ActionButton aria-expanded={all} onClick={() => setAll(!all)} size="s" variant="quiet">
            {all ? "Show fewer" : `Show all ${items.length}`}
          </ActionButton>
        </div>
      )}
    </section>
  );
}
