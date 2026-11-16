import { Badge } from "@/components/ui/badge";
import { MARK_LABELS } from "@hub/config";
import { isOld, wrote } from "@/lib/format";
import { notionOf } from "@/lib/notion";
import { cn } from "@/lib/utils";
import { chipsOf } from "../list-row";
import type { ReviewDraft } from "../source";
import type { ReviewActions } from "../use-review-actions";
import { ClientMenu } from "./client-menu";

type Props = { d: ReviewDraft; actions: ReviewActions; now: number; ready: boolean };

/** Name and email, the Client menu at the far side, at most two chips plus the read-only flags, the age line. */
export function CardHeader({ d, actions, now, ready }: Props) {
  const age = wrote(d.client.lastContactAt, now);
  const old = d.status === "ready" && isOld(d.updatedAt, now);
  const notion = notionOf(d);
  const flags = d.client.marks.filter((m) => m !== "do_not_contact");
  return (
    <header className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-base">{d.client.name}</h3>
          <p className="truncate text-muted-foreground text-sm">{d.client.email}</p>
        </div>
        <ClientMenu actions={actions} d={d} />
      </div>
      {(chipsOf(d).length > 0 || ready || flags.length > 0 || notion.kind !== null) && (
        <p className="flex flex-wrap items-center gap-1.5">
          {chipsOf(d).map((c) => (
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
      {age && <p className={cn("text-sm", old ? "text-warning-foreground" : "text-muted-foreground")}>{age}</p>}
      {d.client.marks.includes("do_not_contact") && (
        <p className="rounded-lg border border-destructive/32 bg-destructive/8 p-3 text-sm" role="note">
          Do not contact. Send is removed for this client; turn the flag off in the Client menu.
        </p>
      )}
    </header>
  );
}
