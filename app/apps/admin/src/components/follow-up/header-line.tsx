"use client";

import { CalendarClockIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import { useFollowUps } from "@/lib/data/project";
import { ChangeDate, useFollowUpMoves } from "./moves";
import { headerLine, moves as movesOf, planOf } from "./words";

/**
 * P142 F6 (verdict 15): the follow-up plan in the conversation header (Mail and Messengers), beside "Map · …": "Follow-up · next
 * 30 Nov · 2nd sent 25 Nov · waiting on them". Its menu holds the owner's Change date and Stop (or Resume). Read from the project's
 * one follow-ups list (the live `follow-ups` topic refreshes it); a client with no plan shows nothing.
 */
export function FollowUpLine({ project, clientId }: { project: string; clientId: number }) {
  const q = useFollowUps(project);
  const r = planOf(q.data?.rows, clientId);
  const m = useFollowUpMoves(project);
  const [dating, setDating] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (!r) return null;
  const can = movesOf(r);
  const line = headerLine(r);
  return (
    <>
      <Menu>
        <MenuTrigger render={<ActionButton aria-label={`${line}: change or stop`} data-testid="follow-up-line" ref={anchor} size="s" variant="quiet" />}>
          <CalendarClockIcon aria-hidden="true" />
          {line}
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuItem disabled={m.pending} onClick={() => setDating(true)}>
            Change date…
          </MenuItem>
          <MenuSeparator />
          {can.stop && (
            <MenuItem disabled={m.pending} onClick={() => m.stop(r)} variant="destructive">
              Stop follow-ups
            </MenuItem>
          )}
          {can.resume && (
            <MenuItem disabled={m.pending} onClick={() => m.resume(r)}>
              Resume follow-ups
            </MenuItem>
          )}
        </MenuPopup>
      </Menu>
      {dating && <ChangeDate anchor={anchor} moves={m} onOpenChange={setDating} open={dating} r={r} />}
      {m.error && !dating && (
        <span className="text-destructive-foreground text-xs" role="alert">
          {m.error}
        </span>
      )}
    </>
  );
}
