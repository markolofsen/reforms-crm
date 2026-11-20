import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { MARK_LABELS } from "@hub/config";
import { AppLink } from "@/components/app-link";
import { isOld, wrote } from "@/lib/format";
import { paths } from "@/routes/paths";
import { notionOf } from "@/lib/notion";
import { cn } from "@hub/ui/cn";
import { chipsOf } from "../list-row";
import type { ReviewDraft } from "../source";
import type { ReviewActions } from "../use-review-actions";
import { ClientMenu } from "./client-menu";
import { sentLine, teammateLine } from "./card-state";

type Props = { d: ReviewDraft; actions: ReviewActions; now: number; ready: boolean };


/** Name and email, the Client menu at the far side, at most two chips plus the read-only flags, the age line. */
export function CardHeader({ d, actions, now, ready }: Props) {
  const age = wrote(d.client.lastContactAt, now);
  const old = d.status === "ready" && isOld(d.updatedAt, now);
  const notion = notionOf(d);
  // The checks are listed whole right under the header ("1 check before sending"): a second "1 check" chip would say it twice (rubric 3).
  const chips = chipsOf(d).filter((c) => c.id !== "checks");
  const flags = d.client.marks.filter((m) => m !== "do_not_contact");
  const sent = sentLine(d);
  const teammate = teammateLine(d);
  return (
    <header className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-base">{d.client.name}</h3>
          <p className="truncate text-muted-foreground text-sm">{d.client.email}</p>
        </div>
        <ClientMenu actions={actions} d={d} />
      </div>
      {(chips.length > 0 || ready || flags.length > 0 || notion.kind !== null) && (
        <p className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <Badge key={c.text} variant={c.variant}>
              {c.text}
            </Badge>
          ))}
          {ready && <Badge variant="success">Ready to send</Badge>}
          {notion.kind === "lead" && <Badge variant="outline">Lead</Badge>}
          {notion.kind === "none" && <Badge variant="outline">No Notion page</Badge>}
          {flags.map((m) => (
            <Badge key={m} variant="outline">
              {MARK_LABELS[m]}
            </Badge>
          ))}
        </p>
      )}
      {sent && (
        <p className="font-medium text-sm" data-testid="sent-line">
          {sent}
        </p>
      )}
      {teammate && (
        // P90: a teammate (or the owner elsewhere) answered this thread, or wrote to the client per Notion.
        <p className="text-sm text-warning-foreground" data-testid="teammate-line" role="note">
          {teammate}
        </p>
      )}
      {age && <p className={cn("text-sm", old ? "text-warning-foreground" : "text-muted-foreground")}>{age}</p>}
      {d.otherDrafts > 0 && (
        // P87 (B3): the client's earlier drafts are history, listed in Finished and in the client's own Activity.
        <p className="text-muted-foreground text-sm" data-testid="other-drafts">
          {d.otherDrafts === 1 ? "1 other draft" : `${d.otherDrafts} other drafts`} to this client ·{" "}
          <AppLink className="text-sm" to={paths.log.list({ client: d.clientId })}>
            History
          </AppLink>
        </p>
      )}
      {d.sequence && (
        // P47: a follow-up step. The owner sends it from Mail (the hub refuses it); Stop ends the client's follow-ups and skips this step.
        <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="follow-up-step">
          <Badge variant="info">
            Follow-up {d.sequence.step} of {d.sequence.steps}
          </Badge>
          {d.sequence.state === "finished" ? (
            <span className="text-muted-foreground">Follow-ups have ended for this client.</span>
          ) : (
            <ActionButton disabled={actions.pending} onClick={() => actions.stopFollowUps(d)} size="s" variant="quiet">
              Stop follow-ups
            </ActionButton>
          )}
        </p>
      )}
      {d.client.marks.includes("do_not_contact") && (
        <p className="rounded-lg border border-destructive/32 bg-destructive/8 p-3 text-sm" role="note">
          Do not contact. Send is removed for this client; turn the flag off in the Client menu.
        </p>
      )}
    </header>
  );
}
