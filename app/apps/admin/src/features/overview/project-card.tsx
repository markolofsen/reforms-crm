import type { ReactNode } from "react";
import type { ProjectCardDto } from "@hub/contract/overview";
import { ActionButton } from "@hub/ui/product/action-button";
import { AppLink } from "@/components/app-link";
import { Progress } from "@hub/ui/product/field";
import { Badge } from "@hub/ui/badge";
import { ago, hhmm, plural } from "@/lib/format";
import { paths } from "@/routes/paths";
import { countText, type Live } from "./labels";
import { FreshnessNote, MailboxRow, ReadFailure } from "./mailbox-row";
import { sourcesOf } from "./use-overview";

const RECIPIENTS = { test: "Test list only", listed: "Listed addresses", any: "Any address" } as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 text-end text-sm tabular-nums max-sm:text-start">{children}</dd>
    </div>
  );
}

/** One Notion data source: its count (with a `+` at the page cap), or why it has none. `null` source: the project does not list it, so no row. */
function NotionRow({ label, source, now, reading }: { label: string; source: ProjectCardDto["notion"]["clients"]; now: number; reading: boolean }) {
  if (!source) return null;
  const b = source.count;
  const value = "value" in b ? b.value : undefined;
  const live: Live<unknown> = b;
  return (
    <Row label={`Notion ${label}`}>
      <span className="flex flex-col items-end gap-0.5 max-sm:items-start">
        <span>{value ? countText(value.count, value.capped) : b.state === "never" ? "Not read yet" : "No count yet"}</span>
        <ReadFailure b={live} />
        {reading ? <span className="text-info-foreground text-xs">Reading Notion...</span> : <FreshnessNote b={live} now={now} />}
      </span>
    </Row>
  );
}

type Props = { p: ProjectCardDto; now: number; focused: boolean; reading: boolean; locked: boolean; onRefresh: () => void };

/**
 * One project, read-only: its facts as a definition list, its mailboxes, its Notion counts, and the two ways into it.
 * Local numbers (drafts, sends, flags) are always current; live ones carry their state and time. Refresh reads Mail and
 * Notion for this project and writes nothing.
 */
export function ProjectCard({ p, now, focused, reading, locked, onRefresh }: Props) {
  const heading = `project-${p.slug}-name`;
  const sources = sourcesOf(p);
  const { drafts, sends } = p;
  const owe = p.owe;
  const oweValue = "value" in owe ? owe.value : undefined;
  return (
    <section aria-labelledby={heading} className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 outline-none ${focused ? "ring-2 ring-ring" : ""}`} data-focused={focused} id={`project-${p.slug}`} tabIndex={-1}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="min-w-0 break-words font-heading font-medium text-base" id={heading}>
          <AppLink bare className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring inline-flex min-h-(--control-s) items-center" inProject={p.slug} to={paths.project.page()}>
            {p.name}
          </AppLink>
        </h3>
        <Badge variant={p.status === "active" ? "success" : "secondary"}>{p.status}</Badge>
        <Badge variant="outline">{p.kind}</Badge>
        {p.archived && <Badge variant="secondary">Archived</Badge>}
      </div>
      <dl className="divide-y">
        <Row label="Owe a reply">
          {oweValue !== undefined ? (
            <span>
              {oweValue}
              <span className="block text-muted-foreground text-xs">{p.lastTriageAt ? `as of the last triage, ${ago(p.lastTriageAt, now)}` : "as of the last triage"}</span>
            </span>
          ) : p.lastTriageAt === null ? (
            "Never triaged"
          ) : (
            <span className="text-muted-foreground">Not recorded yet</span>
          )}
        </Row>
        <Row label="Last triage">{p.lastTriageAt ? `${hhmm(p.lastTriageAt)}, ${ago(p.lastTriageAt, now)}` : "Never triaged"}</Row>
        <Row label="Drafts">
          <AppLink className="tabular-nums" inProject={p.slug} to={paths.drafts.list({ filter: "ready" })}>
            {drafts.ready} ready
          </AppLink>
          {", "}
          <AppLink className="tabular-nums" inProject={p.slug} to={paths.drafts.list({ filter: "hold" })}>
            {drafts.hold} on hold
          </AppLink>
          <span className="block text-muted-foreground text-xs">
            {drafts.done} done, {drafts.skipped} skipped, {drafts.sent} sent
          </span>
        </Row>
        {p.injectionHeld > 0 && (
          <Row label="Suspicious mail">
            <AppLink inProject={p.slug} to={paths.drafts.list({ filter: "ready" })}>
              {p.injectionHeld} held
            </AppLink>
          </Row>
        )}
        <Row label="Sent today">
          {sends.today}
          <span className="block text-muted-foreground text-xs">since {hhmm(sends.since)}; no limit on manual sends</span>
        </Row>
        {sends.auto.mode === "auto" && (
          <Row label="Automatic sends, 24 h">
            <span className="flex min-w-32 flex-col gap-1">
              <span>
                {sends.auto.used24h} of {sends.auto.cap}
              </span>
              <Progress label={`Automatic sends in 24 hours: ${sends.auto.used24h} of ${sends.auto.cap}`} max={sends.auto.cap} value={sends.auto.used24h} />
            </span>
          </Row>
        )}
        {sends.stopped && <Row label="Sending">Stopped</Row>}
        {(sends.failed24h > 0 || sends.stuck > 0) && (
          <Row label="Send problems">
            {[sends.failed24h > 0 && `${plural(sends.failed24h, "failure")} in 24 h`, sends.stuck > 0 && `${sends.stuck} stuck`].filter(Boolean).join(", ")}
          </Row>
        )}
        <Row label="Recipients">{RECIPIENTS[p.recipients]}</Row>
        <NotionRow label="clients" now={now} reading={reading} source={p.notion.clients} />
        <NotionRow label="leads" now={now} reading={reading} source={p.notion.leads} />
      </dl>
      {p.mailboxes.length > 0 && (
        <div className="flex flex-col">
          <h4 className="font-medium text-sm">Mailboxes</h4>
          <ul aria-label={`Mailboxes of ${p.name}`} className="divide-y">
            {p.mailboxes.map((m) => (
              <MailboxRow key={m.account} m={m} now={now} reading={reading} />
            ))}
          </ul>
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2">
        {sources.length > 0 ? (
          <ActionButton aria-busy={reading} aria-label={reading ? undefined : `Refresh ${p.name}`} disabled={locked} onClick={onRefresh} size="s" variant="secondary">
            {reading ? "Refreshing..." : "Refresh"}
          </ActionButton>
        ) : (
          <span className="text-muted-foreground text-xs">No mailbox or Notion source to read.</span>
        )}
        <AppLink inProject={p.slug} to={paths.drafts.list()}>
          Open drafts
        </AppLink>
        <AppLink inProject={p.slug} to={paths.project.page()}>
          Open project
        </AppLink>
      </div>
    </section>
  );
}
