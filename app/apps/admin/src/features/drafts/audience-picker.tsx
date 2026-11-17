import { AUDIENCE_LABELS, AUDIENCES, EXCLUSION_LABELS, EXCLUSION_REASONS, type Audience } from "@hub/config";
import type { AudienceDto } from "@hub/contract/responses";
import { Field } from "@hub/ui/product/field";
import { FilterChips } from "@hub/ui/product/filter-chips";
import { LoadFailed, Loading } from "@/components/state-views";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { Checkbox } from "@hub/ui/checkbox";
import { Input } from "@hub/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/table";
import { silence } from "@/lib/format";

const SHOWN = 500;

export type AudienceClient = AudienceDto["clients"][number];

type Props = {
  audience: Audience;
  onAudience: (a: Audience) => void;
  silentDays: string;
  onSilentDays: (v: string) => void;
  days: number;
  data: AudienceDto | undefined;
  error: unknown;
  loading: boolean;
  onRetry: () => void;
  clients: AudienceClient[];
  eligible: number;
  selected: number;
  unticked: Set<number>;
  onToggle: (id: number, on: boolean) => void;
  onAll: () => void;
  onNone: () => void;
  now: number;
};

/**
 * Step 1, who: the audience chips with counts, the people in it, and a tick for each one that is eligible. Why a client is left out
 * is said once, in the "Left out" line; a left-out row is muted with its tick disabled, and keeps the reason as text for a screen reader.
 */
export function AudiencePicker(p: Props) {
  const chips = AUDIENCES.map((a) => ({ value: a, label: a === "silent" ? `${AUDIENCE_LABELS[a]} ${p.days}+ days` : AUDIENCE_LABELS[a], count: p.data?.counts[a] }));
  const left = EXCLUSION_REASONS.flatMap((r) => {
    const n = p.clients.filter((c) => c.reason === r).length;
    return n > 0 ? [`${n} ${EXCLUSION_LABELS[r].toLowerCase()}`] : [];
  });
  return (
    <section aria-labelledby="who" className="flex flex-col gap-3">
      <h3 className="font-medium text-sm" id="who">
        1. Who
      </h3>
      <FilterChips chips={chips} label="Audience" onChange={p.onAudience} value={p.audience} />
      {p.audience === "silent" && (
        <Field htmlFor="silent-days" label="Silent for at least (days)">
          <Input className="w-28 control-m" id="silent-days" inputMode="numeric" onChange={(e) => p.onSilentDays(e.target.value)} value={p.silentDays} />
        </Field>
      )}
      {p.error ? (
        <LoadFailed error={p.error} onRetry={p.onRetry} what="clients" />
      ) : p.loading && !p.data ? (
        <Loading what="clients" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="tabular-nums" role="status">
              {p.selected} of {p.eligible} selected
            </span>
            <ActionButton onClick={p.onAll} size="s" variant="quiet">
              Select all {p.eligible}
            </ActionButton>
            <ActionButton onClick={p.onNone} size="s" variant="quiet">
              None
            </ActionButton>
          </div>
          {left.length > 0 && <p className="text-muted-foreground text-xs">Left out: {left.join(", ")}.</p>}
          {p.clients.length === 0 ? (
            <p className="text-muted-foreground text-sm">No clients match {AUDIENCE_LABELS[p.audience]} in this project.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <span className="sr-only">Selected</span>
                  </TableHead>
                  <TableHead className="w-full max-w-0">Client</TableHead>
                  <TableHead className="max-sm:hidden">
                    <div className="text-end">Silent</div>
                  </TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.clients.slice(0, SHOWN).map((c) => (
                  <TableRow className={c.reason ? "text-muted-foreground" : undefined} key={c.id}>
                    <TableCell className="max-sm:px-1.5">
                      <label className="-m-2.5 flex size-11 cursor-pointer items-center justify-center lg:m-0 lg:size-6" htmlFor={`include-${c.id}`}>
                        <Checkbox id={`include-${c.id}`} aria-label={`Include ${c.name}`} checked={c.reason === null && !p.unticked.has(c.id)} disabled={c.reason !== null} onCheckedChange={(v) => p.onToggle(c.id, v === true)} />
                      </label>
                    </TableCell>
                    <TableCell className="w-full max-w-0 max-sm:px-1.5">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="truncate text-muted-foreground text-xs">{c.email}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-sm:hidden">
                      <div className="text-end tabular-nums">{silence(c.lastContactAt, p.now)}</div>
                    </TableCell>
                    <TableCell className="max-sm:px-1.5">{c.reason ? <span className="sr-only">{EXCLUSION_LABELS[c.reason]}</span> : c.repliesOwed ? <Badge variant="error">Owes reply</Badge> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {p.clients.length > SHOWN && <p className="text-muted-foreground text-xs">Showing the first {SHOWN} of {p.clients.length}. Every ticked client is included, shown or not.</p>}
        </>
      )}
    </section>
  );
}
