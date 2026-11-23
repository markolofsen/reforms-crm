import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { buildScheme, SCHEME_FORMS } from "@hub/contract/scheme";
import { stateLine } from "@hub/contract/scheme-model";
import { SectionTitle } from "@hub/ui/product/page";
import { Skeleton } from "@hub/ui/skeleton";
import { AppLink } from "@/components/app-link";
import { QueryView } from "@/components/state-views";
import { overviewApi } from "@/lib/api/overview";
import { keys } from "@/lib/cache/keys";
import { dest } from "@/routes/paths";
import { Cuts } from "./cuts";
import { LanesList } from "./scheme-list";
import { SchemeSvg } from "./scheme-svg";

/**
 * How it works (P63 O2, decision 0035; P81, decision 0042): the Hub's main blocks in five lanes and what passes between them, a
 * fixed model (`@hub/contract/scheme-model`) coloured by the live parts of `GET /api/scheme` (the same read as Overview's parts,
 * refetched on the topics its sources move); a dot on a block with a checked part, and one line under the drawing naming the
 * blocks that need a look, so the state is never a colour alone. Then three cuts: what goes through what. Last on Help.
 */
export function HowItWorks() {
  const q = useQuery({ queryKey: keys.scheme(), queryFn: overviewApi.scheme });
  const nodes = q.data?.nodes;
  const texts = useMemo(() => (nodes ? SCHEME_FORMS.map((f) => buildScheme(nodes, f)) : null), [nodes]);
  const line = nodes ? stateLine(nodes) : null;
  return (
    <>
      <section aria-labelledby="help-scheme" className="flex min-w-0 flex-col gap-2" data-testid="how-it-works">
        <SectionTitle id="help-scheme">How it works</SectionTitle>
        <p className="measure text-muted-foreground">
          The Hub’s main blocks in five lanes: what comes in, the agent and what binds it, what it reads, the Hub itself, and what goes out to the client. A dot shows how
          a block’s checked parts stand.
        </p>
        <QueryView loading={<Skeleton aria-busy="true" aria-label="Drawing the scheme" className="h-64 w-full" role="img" />} query={q} what="the scheme">
          {() =>
            texts && (
              <>
                <SchemeSvg labelledBy="help-scheme" list={<LanesList nodes={nodes ?? []} />} testId="scheme-general" texts={texts} />
                <p className="measure" data-testid="scheme-state">
                  {line ?? "Every checked part works."} Every part and its fix are on <AppLink to={dest("overview.page")}>Overview</AppLink>.
                </p>
              </>
            )
          }
        </QueryView>
      </section>
      {nodes && <Cuts nodes={nodes} />}
    </>
  );
}
