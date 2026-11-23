import { TIP_CLIS, TIP_GROUPS, TIPS } from "@hub/contract/tips";
import { SectionTitle } from "@hub/ui/product/shell/page";

/**
 * Tips for the agents (P63 O3), all of them, grouped: the same list the dock's tips button shows per tab (`@hub/contract/tips`),
 * never a second copy. Text only: the desktop handoff stays a row that says why it is not offered.
 */
export function TipsList() {
  return (
    <section aria-labelledby="help-tips" className="flex min-w-0 flex-col gap-1" data-testid="help-tips">
      <SectionTitle id="help-tips">Tips</SectionTitle>
      <p className="measure text-muted-foreground">The same tips sit behind the ⓘ button of each terminal tab.</p>
      <div className="grid gap-x-8 gap-y-3 lg:grid-cols-3">
        {TIP_CLIS.map((cli) => (
          <div className="flex min-w-0 flex-col gap-1" key={cli}>
            <h3 className="font-medium text-muted-foreground text-xs">{TIP_GROUPS[cli]}</h3>
            <ul className="flex flex-col divide-y border-y">
              {TIPS.filter((t) => t.cli === cli).map((t) => (
                <li className="flex min-w-0 flex-col gap-0.5 py-2" data-tip={`${t.cli}:${t.id}`} key={t.id}>
                  <span className="font-medium">{t.title}</span>
                  <span>{t.how}</span>
                  <span className="text-muted-foreground text-xs">{t.why}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
