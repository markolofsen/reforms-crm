import { useQuery } from "@tanstack/react-query";
import { QueryView } from "@/components/state-views";
import { Skeleton } from "@hub/ui/skeleton";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { useConnections } from "../connections/use-connections";
import { SettingsGroup } from "../group";
import { FilterRow, FiltersLine } from "./filters";
import { MailAccounts } from "./mail-accounts";

/**
 * Settings ▸ Mail (P70): which mail the agent reads. The project's accounts as Apple Mail knows them (read only; a missing one is
 * fixed in Mail), then its filters (read only; the phrase that changes them is shown under the row, P75). No sentence of its own: the table's words and the filters'
 * line already say where it stands, and a sentence would repeat them (`admin-principles.md` rule 10).
 */
export function MailPane({ project }: { project: string }) {
  const conn = useConnections();
  const facts = useQuery({ queryKey: keys.project(project), queryFn: () => metaApi.overview(project) });
  return (
    <>
      <SettingsGroup id="mail-accounts" title="Accounts">
        <QueryView loading={<Skeleton aria-label="Loading the mail accounts" className="h-16 w-full rounded-xl" role="status" />} query={conn} what="the mail accounts">
          {(c) => <MailAccounts mail={c.mail.filter((m) => m.usedBy.includes(project))} read={c.mailRead} />}
        </QueryView>
      </SettingsGroup>
      <QueryView
        loading={<ul aria-label="Mail filters" className="flex flex-col divide-y border-y"><FilterRow summary="Reading..." /></ul>}
        query={facts}
        what="the mail filters"
      >
        {(f) => <ul aria-label="Mail filters" className="flex flex-col divide-y border-y"><FiltersLine f={f.filters} /></ul>}
      </QueryView>
    </>
  );
}
