import type { MailAccountDto, MailReadDto } from "@hub/contract/connections";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { foundLook } from "./labels";

/**
 * The projects' mail accounts as Apple Mail knows them, read-only: the Hub holds no mail key (decision 0026), it reads and
 * sends only through Mail. A missing account is fixed in Mail itself, so the row offers no control. A Mail that runs but does
 * not answer is said once under the table, with its fix line; the rest of the page is not held back by it.
 */
export function MailAccounts({ mail, read }: { mail: readonly MailAccountDto[]; read: MailReadDto }) {
  if (mail.length === 0) return <p className="measure text-muted-foreground text-sm">No project lists a mail account yet. The agent adds one with project-setup.</p>;
  return (
    <>
      <DataTable aria-label="Mail accounts">
        <TableHeader>
          <TableRow>
            <TableHead className="w-2/5">Account</TableHead>
            <TableHead className="w-1/3">In Apple Mail</TableHead>
            <TableHead>Used by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mail.map((m) => {
            const { word, Icon, tone } = foundLook(m.foundInMail, read.state);
            return (
              <TableRow data-account={m.account} key={m.account}>
                <TableCell className="break-all font-medium">{m.account}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center gap-1.5 ${tone}`}>
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    {word}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{m.usedBy.join(", ")}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </DataTable>
      {read.fix && (
        <p className="measure mt-2 text-muted-foreground text-sm" data-mail-read={read.state}>
          Apple Mail is running but did not answer, so the accounts could not be checked. {read.fix}
        </p>
      )}
    </>
  );
}
