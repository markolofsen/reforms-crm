import { useQuery } from "@tanstack/react-query";
import { FactLine } from "@/components/fact-line";
import { LoadFailed } from "@/components/state-views";
import { Skeleton } from "@hub/ui/skeleton";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { useConnections } from "../connections/use-connections";
import { SettingsGroup } from "../group";
import { FiltersLine } from "./filters";
import { MailAccounts } from "./mail-accounts";

/**
 * Settings ▸ Mail (P70): which mail the agent reads. The project's accounts as Apple Mail knows them (read only; a missing one is
 * fixed in Mail), then its filters (read only; a phrase changes them). No sentence of its own: the table's words and the filters'
 * line already say where it stands, and a sentence would repeat them (`admin-principles.md` rule 10).
 */
export function MailPane({ project }: { project: string }) {
  const conn = useConnections();
  const facts = useQuery({ queryKey: keys.project(project), queryFn: () => metaApi.overview(project) });
  const mine = (conn.data?.mail ?? []).filter((m) => m.usedBy.includes(project));
  return (
    <>
      <SettingsGroup id="mail-accounts" title="Accounts">
        {conn.isPending ? (
          <Skeleton aria-label="Loading the mail accounts" className="h-16 w-full rounded-xl" role="status" />
        ) : !conn.data ? (
          <LoadFailed error={conn.error} onRetry={() => void conn.refetch()} retrying={conn.isFetching} what="the mail accounts" />
        ) : (
          <MailAccounts mail={mine} read={conn.data.mailRead} />
        )}
      </SettingsGroup>
      {facts.isError && <LoadFailed error={facts.error} onRetry={() => void facts.refetch()} retrying={facts.isFetching} what="the mail filters" />}
      <ul aria-label="Mail filters" className="flex flex-col divide-y border-y">
        {facts.data ? <FiltersLine f={facts.data.filters} /> : !facts.isError && <FactLine summary="Reading..." title="Filters" />}
      </ul>
    </>
  );
}
