import type { ProjectOverviewDto } from "@hub/contract/project";
import { phrase } from "@hub/contract/help";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";

type Booking = NonNullable<ProjectOverviewDto["booking"]>;

/** What one brand's threads get, in words: its own link, the project's, or none. */
const brandWord = (b: Extract<Booking, { state: "ok" }>["brands"][number]): string => (b.cell === "none" ? "None (this brand never offers one)" : b.url ? (b.cell ? b.url : `${b.url} (the project's)`) : "None");

/**
 * Settings ▸ Mail ▸ Booking (P155): the link the agent offers to pull a client to a call, the project's and each brand's, read
 * only. The owner sets them with `hub project setup` or in project.md (no admin door writes project.md); the line under the
 * table says how. Once per thread, enforced at the agent's write.
 */
export function BookingLinks({ booking }: { booking: ProjectOverviewDto["booking"] }) {
  const how = (
    <p className="measure mt-2 text-muted-foreground text-sm">
      The agent offers the link once per conversation where a call helps. To change them, say “{phrase("project-setup")}” in a session (project-setup), or run{" "}
      <code className="break-all rounded-sm bg-muted px-1.5 py-0.5 text-xs">hub project setup &lt;project&gt; --booking &lt;url&gt; --brand-booking &lt;Brand&gt;=&lt;url&gt;</code>.
    </p>
  );
  if (!booking || booking.state === "absent") return <p className="measure text-muted-foreground text-sm">The project is not registered yet: no booking link is read.</p>;
  if (booking.state === "error") return <p className="measure text-warning-foreground text-sm">{booking.message}</p>;
  const project = booking.setting === "none" ? "None (booking.url: none)" : (booking.url ?? "Not set");
  return (
    <>
      <DataTable aria-label="Booking links">
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/3">For</TableHead>
            <TableHead>Booking link</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow data-booking="project">
            <TableCell className="font-medium">The project</TableCell>
            <TableCell className="break-all">{project}</TableCell>
          </TableRow>
          {booking.brands.map((b) => (
            <TableRow data-booking={b.brand} key={b.brand}>
              <TableCell className="font-medium">{b.brand}</TableCell>
              <TableCell className="break-all">{brandWord(b)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
      {how}
    </>
  );
}
