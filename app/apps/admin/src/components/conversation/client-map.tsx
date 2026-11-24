"use client";

import { WorkflowIcon } from "lucide-react";
import { useId, useState } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Sheet, SheetDescription, SheetHeader, SheetPanel, SheetPopup, SheetTitle, SheetTrigger } from "@hub/ui/sheet";
import { Switch } from "@hub/ui/switch";
import { EmptyState, QueryView } from "@/components/state-views";
import { useClientMap } from "@/lib/data/conversations";
import { useClock } from "@/lib/clock";
import { ago, formatTime } from "@/lib/format";
import { MapDrawing, MapOutline } from "./client-map-view";

/**
 * P135 verdict 8: the conversation header's Map button (Mail and Messengers, the shared workspace) and its wide side sheet: the map
 * the agent last drew, "Updated <when>", the previous version on a switch, fit or actual size, and the outline. The map is read
 * when the sheet opens; a new version moves the client row, so the live `clients` topic reads it again. A lead has no map.
 */
export type MapSubject = { project: string; clientId: number; name: string };

export function ClientMapButton({ subject, className, short }: { subject: MapSubject; className?: string; short?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger render={<ActionButton aria-label="Open the client map" className={className} data-testid="client-map-button" size="s" tooltip={{ content: "The client map" }} variant="quiet" />}>
        <WorkflowIcon aria-hidden="true" />
        <span className={short}>Map</span>
      </SheetTrigger>
      <SheetPopup className="max-w-3xl" data-testid="client-map-sheet" side="right">
        <SheetHeader>
          <SheetTitle>Client map</SheetTitle>
          <SheetDescription>{subject.name}: the goals, what is open and what we did, as the agent last drew it.</SheetDescription>
        </SheetHeader>
        <SheetPanel>{open && <ClientMapBody subject={subject} />}</SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}

function ClientMapBody({ subject }: { subject: MapSubject }) {
  const q = useClientMap(subject.project, subject.clientId, true);
  const now = useClock()();
  const caption = useId();
  const [previous, setPrevious] = useState(false);
  const [actual, setActual] = useState(false);
  return (
    <QueryView empty={<EmptyState title="No map yet">The agent draws one with the next reply.</EmptyState>} isEmpty={(m) => m.source === null} query={q} what="the client map">
      {(m) => {
        const old = previous && m.previous ? m.previous : null;
        const source = old?.source ?? m.source ?? "";
        const at = old?.at ?? m.updatedAt;
        return (
          <div className="flex flex-col gap-3" data-testid="client-map">
            <div className="flex flex-wrap items-center gap-3">
              <p className="me-auto text-muted-foreground text-sm" data-testid="client-map-updated" id={caption} role="status">
                {old ? "Previous version, drawn" : "Updated"} {at ? `${formatTime(at)} (${ago(at, now)})` : ""}
              </p>
              {m.previous && (
                <label className="flex min-h-(--control-s) items-center gap-2 text-sm">
                  <Switch checked={previous} data-testid="client-map-previous" onCheckedChange={setPrevious} />
                  Previous version
                </label>
              )}
              <ActionButton aria-pressed={actual} onClick={() => setActual((v) => !v)} size="s" variant="quiet">
                {actual ? "Fit to the sheet" : "Actual size"}
              </ActionButton>
            </div>
            <MapDrawing actual={actual} key={source} labelledBy={caption} source={source} />
            <MapOutline source={source} />
          </div>
        );
      }}
    </QueryView>
  );
}
