"use client";

import { WorkflowIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { checkClientMap } from "@hub/diagram/map";
import { mapCorrectPhrase, mapDrawPhrase } from "@hub/contract/help";
import { notionPageDestination } from "@hub/contract/local";
import { ActionButton } from "@hub/ui/product/action-button";
import { Sheet, SheetDescription, SheetHeader, SheetPanel, SheetPopup, SheetTitle, SheetTrigger } from "@hub/ui/sheet";
import { EmptyState, QueryView } from "@/components/state-views";
import { OpenLinkButton } from "@/components/links/open-link";
import { useTerminal } from "@/features/terminal/use-terminal";
import { useClientMap } from "@/lib/data/conversations";
import { useClock } from "@/lib/clock";
import { copyText } from "@/lib/external";
import { ago, formatTime } from "@/lib/format";
import { MapChanges } from "./client-map-diff";
import { mapSummary } from "./client-map-sources";
import { MapDrawing, MapLegend, MapOutline } from "./client-map-view";

/**
 * P135 verdict 8, P136 verdict 7: the client map under the name in the conversation header (Mail and Messengers, the shared
 * workspace). With a map, "Map · 3 open · 1 waiting" opens the wide side sheet; without one, "Draw map" puts the request into the
 * dock terminal for the owner to press Enter (P96's door: `pasteToAgent`, never Enter, never a send). The sheet: Updated, Correct
 * (the same door: "redraw the map of <client>: " for him to finish), Copy Mermaid, Open in Notion, the legend, the drawing, what
 * changed since the previous version with the agent's reasons, and the outline, whose source buttons show the node's messages in
 * the thread (`onShowSources`). The map is read with the header; a new version moves the client row (the live `clients` topic).
 */
export type MapSubject = { project: string; clientId: number; name: string; email: string | null; notionPageId?: string | null };
type ShowSources = (refs: string[], label: string) => void;

export function ClientMapLine({ subject, onShowSources }: { subject: MapSubject; onShowSources?: ShowSources }) {
  const q = useClientMap(subject.project, subject.clientId, true);
  const { pasteToAgent } = useTerminal();
  const [open, setOpen] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const m = q.data;
  const client = { name: subject.name, email: subject.email };
  if (m && m.source === null) {
    return (
      <ActionButton data-testid="client-map-draw" onClick={() => pasteToAgent(mapDrawPhrase(client))} size="s" tooltip={{ content: "Puts the request into the terminal; you press Enter" }} variant="quiet">
        <WorkflowIcon aria-hidden="true" />
        Draw map
      </ActionButton>
    );
  }
  const g = m?.source ? checkClientMap(m.source, { sources: "optional" }) : null;
  const label = g?.ok ? `Map · ${mapSummary(g)}` : "Map";
  const correct = () => {
    setOpen(false);
    pasteToAgent(mapCorrectPhrase(client));
  };
  const show = (refs: string[], node: string) => {
    setOpen(false);
    onShowSources?.(refs, node);
  };
  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger render={<ActionButton data-testid="client-map-button" size="s" variant="quiet" />}>
        <WorkflowIcon aria-hidden="true" />
        {label}
      </SheetTrigger>
      {/* Focus starts on the title, not on Correct: Correct is a tooltip trigger, a focused one opens its tooltip, and that tooltip
          took the first Esc, so the sheet opened from the keyboard stayed open (P134's lesson, P136 e2e). Tab reaches the rest. */}
      <SheetPopup className="max-w-3xl" data-testid="client-map-sheet" initialFocus={title} side="right">
        <SheetHeader>
          <SheetTitle className="outline-none" ref={title} tabIndex={-1}>
            Client map
          </SheetTitle>
          <SheetDescription>{subject.name}: the goals, what is open and what we did, as the agent last drew it.</SheetDescription>
        </SheetHeader>
        <SheetPanel>{open && <ClientMapBody onCorrect={correct} onShow={onShowSources ? show : undefined} subject={subject} />}</SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}

function ClientMapBody({ subject, onCorrect, onShow }: { subject: MapSubject; onCorrect: () => void; onShow?: ShowSources }) {
  const q = useClientMap(subject.project, subject.clientId, true);
  const now = useClock()();
  const caption = useId();
  const [actual, setActual] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const notion = notionPageDestination(subject.notionPageId ?? null);
  return (
    <QueryView empty={<EmptyState title="No map yet">The agent draws one with the next reply.</EmptyState>} isEmpty={(m) => m.source === null} query={q} what="the client map">
      {(m) => {
        const source = m.source ?? "";
        const parsed = checkClientMap(source, { sources: "optional" });
        const sources = m.sources ?? (parsed.ok ? parsed.sources : {});
        return (
          <div className="flex flex-col gap-4" data-testid="client-map">
            <p className="text-muted-foreground text-sm" data-testid="client-map-updated" id={caption}>
              Updated {m.updatedAt ? `${formatTime(m.updatedAt)} (${ago(m.updatedAt, now)})` : ""} · {m.versions === 1 ? "1 version" : `${m.versions} versions`}
            </p>
            <div aria-label="Map tools" className="flex flex-wrap items-center gap-2" role="group">
              <ActionButton data-testid="client-map-correct" onClick={onCorrect} size="s" tooltip={{ content: "Puts “redraw the map of …: ” into the terminal for you to finish; nothing is sent" }} variant="primary">
                Correct
              </ActionButton>
              <ActionButton data-testid="client-map-copy" onClick={() => void copyText(source).then((ok) => setSaid(ok ? "The Mermaid text is on the clipboard." : "The browser refused the clipboard."))} size="s" variant="secondary">
                Copy Mermaid
              </ActionButton>
              {notion && <OpenLinkButton ariaLabel={(l) => (l.inApp ? "Open the client in Notion" : "Open the client's Notion page in the browser")} size="s" to={notion} variant="secondary">{() => "Open in Notion"}</OpenLinkButton>}
              <ActionButton aria-pressed={actual} onClick={() => setActual((v) => !v)} size="s" variant="quiet">
                {actual ? "Fit to the sheet" : "Actual size"}
              </ActionButton>
              <span className="sr-only" role="status">{said}</span>
            </div>
            <MapLegend />
            <MapDrawing actual={actual} key={source} labelledBy={caption} source={source} />
            <MapChanges previous={m.previous} reasons={m.reasons} source={source} />
            <MapOutline onShow={onShow ? (id, label) => onShow(sources[id] ?? [], label) : undefined} source={source} sources={sources} />
          </div>
        );
      }}
    </QueryView>
  );
}
