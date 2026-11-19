import { RefreshCwIcon } from "lucide-react";
import type { CoreUpdateDto } from "@hub/contract/instance";
import { ActionButton } from "@hub/ui/product/action-button";
import { CopyFix } from "@/components/copy-fix";
import { formatTime } from "@/lib/format";
import { checkedLine, commandText, CORE_LEVEL_WORDS, factsLine } from "./core-labels";

type Props = { d: CoreUpdateDto; now: number; checking: boolean; onCheck: () => void; said: { text: string; kind: "status" | "alert" } | null };

/**
 * The core block on `/health` (P68 verdict 5b): the pin, the newest tag, the level with its reason, the newer tags' subject lines,
 * the facts, when it was checked, Check now, and the instance's own command with the copy button. Plain props, so a test renders it.
 */
export function CoreView({ d, now, checking, onCheck, said }: Props) {
  const facts = factsLine(d);
  return (
    <section aria-labelledby="core-title" className="grid gap-3" data-testid="core-block">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-lg" id="core-title">Core</h2>
        <ActionButton aria-busy={checking} disabled={checking} onClick={onCheck} size="s" variant="secondary">
          <RefreshCwIcon aria-hidden="true" />
          {checking ? "Checking..." : "Check now"}
        </ActionButton>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Pinned</dt>
        <dd>{d.pin ?? "none"}{d.inUse && d.inUse !== d.pin ? ` (in use: ${d.inUse})` : ""}</dd>
        <dt className="text-muted-foreground">Newest tag</dt>
        <dd>{d.follows ? `follows ${d.follows.branch}` : (d.newest ?? "not known")}</dd>
        <dt className="text-muted-foreground">Update</dt>
        <dd data-testid="core-level">{`${CORE_LEVEL_WORDS[d.level]}: ${d.reason}`}</dd>
      </dl>
      {d.tags.length > 0 && (
        <ul aria-label="Newer releases" className="grid gap-1 text-sm">
          {d.tags.map((t) => (
            <li className="flex min-w-0 flex-wrap gap-x-2" key={t.name}>
              <span className="font-medium">{t.name}</span>
              {t.date && <span className="text-muted-foreground">{formatTime(t.date)}</span>}
              <span className="min-w-0 break-words text-muted-foreground">{t.subject || "no release note"}</span>
            </li>
          ))}
        </ul>
      )}
      {facts && <p className="measure text-sm">{facts}</p>}
      {d.command.length > 0 && (
        <div className="flex min-w-0 items-start gap-1" data-testid="core-command">
          <pre className="min-w-0 flex-1 select-all overflow-x-auto whitespace-pre-wrap break-all rounded-sm bg-muted px-2 py-1 text-xs">{commandText(d)}</pre>
          <CopyFix fix={commandText(d)} label="Copy the update command" />
        </div>
      )}
      <p className="measure text-muted-foreground text-xs">{checkedLine(d, now)}</p>
      <div className="min-h-5 text-sm">
        <p role="status">{said?.kind === "status" ? said.text : ""}</p>
        <p className="text-destructive-foreground" role="alert">{said?.kind === "alert" ? said.text : ""}</p>
      </div>
    </section>
  );
}
