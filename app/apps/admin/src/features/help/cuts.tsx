import { useMemo } from "react";
import { buildCut, SCHEME_FORMS, type SchemeNode } from "@hub/contract/scheme";
import { CUTS, type Cut } from "@hub/contract/scheme-model";
import { SectionTitle } from "@hub/ui/product/page";
import { CutList } from "./scheme-list";
import { SchemeSvg } from "./scheme-svg";

/**
 * The three cuts under the general view (P81, decision 0042): what goes through what, stacked, no switcher (a tab bar would be a
 * control that is no owner decision, `admin-principles.md` rule 1). The same blocks as the general view, so the same dots.
 */
function CutView({ cut, nodes }: { cut: Cut; nodes: readonly SchemeNode[] }) {
  const texts = useMemo(() => SCHEME_FORMS.map((f) => buildCut(cut.id, nodes, f)), [cut.id, nodes]);
  const id = `help-cut-${cut.id}`;
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2" data-cut={cut.id}>
      <SectionTitle id={id}>{cut.title}</SectionTitle>
      <p className="measure text-muted-foreground">{cut.what}</p>
      <SchemeSvg labelledBy={id} list={<CutList cut={cut.id} />} testId={`scheme-${cut.id}`} texts={texts} />
    </section>
  );
}

export function Cuts({ nodes }: { nodes: readonly SchemeNode[] }) {
  return (
    <>
      {CUTS.map((c) => (
        <CutView cut={c} key={c.id} nodes={nodes} />
      ))}
    </>
  );
}
