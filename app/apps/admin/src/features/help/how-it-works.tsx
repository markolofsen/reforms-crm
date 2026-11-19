import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { buildScheme } from "@hub/contract/scheme";
import { SectionTitle } from "@hub/ui/product/page";
import { Skeleton } from "@hub/ui/skeleton";
import { AppLink } from "@/components/app-link";
import { LoadFailed } from "@/components/state-views";
import { overviewApi } from "@/lib/api/overview";
import { keys } from "@/lib/cache/keys";
import { paths } from "@/routes/paths";
import { SchemeSvg } from "./scheme-svg";

/**
 * How it works (P63 O2, decision 0035): the Hub's wiring drawn from live state, last on Help (the heaviest and least read part).
 * The same read as Overview's parts (`GET /api/scheme`, refetched on the topics its sources move), so the drawing is never a
 * hand-made picture; each part says how it stands in a word. Its text alternative is Overview's "All parts", one link away.
 */
export function HowItWorks() {
  const q = useQuery({ queryKey: keys.scheme(), queryFn: overviewApi.scheme });
  const text = useMemo(() => (q.data ? buildScheme(q.data) : null), [q.data]);
  return (
    <section aria-labelledby="help-scheme" className="flex min-w-0 flex-col gap-2" data-testid="how-it-works">
      <SectionTitle id="help-scheme">How it works</SectionTitle>
      <p className="measure text-muted-foreground">
        Client mail reaches a mailbox, the agent reads it through mail-mcp and writes a draft with the Hub tools; you send it from Drafts. Each part and its fix are
        listed on <AppLink to={paths.overview()}>Overview</AppLink>.
      </p>
      {text ? <SchemeSvg labelledBy="help-scheme" text={text} /> : q.isPending ? <Skeleton aria-busy="true" aria-label="Drawing the scheme" className="h-64 w-full" role="img" /> : <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the scheme" />}
    </section>
  );
}
