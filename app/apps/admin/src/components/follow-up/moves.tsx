"use client";

import { useId, useState, type RefObject } from "react";
import type { FollowUpDto } from "@hub/contract/follow-ups";
import { Input } from "@hub/ui/input";
import { Popover, PopoverClose, PopoverDescription, PopoverPopup, PopoverTitle } from "@hub/ui/popover";
import { ActionButton } from "@hub/ui/product/action-button";
import { Field } from "@hub/ui/product/field";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { useClock } from "@/lib/clock";
import { useSetFollowUp } from "@/lib/data/project";
import { validDate } from "./words";

/** The local calendar day of a clock reading, YYYY-MM-DD (a date field's `min` and the check of its value). */
export const localDay = (ms: number): string => new Date(ms).toLocaleDateString("en-CA");

/**
 * The owner's three moves on one plan (P142 F6, verdict 15), shared by Activity ▸ Follow-ups and the conversation header: a new
 * date, Stop (its Undo is Resume, in the toast; the row's state is the lasting record), Resume. They only delay or stop: nothing
 * here drafts or sends. A failure is said inline by the caller (`error`).
 */
export function useFollowUpMoves(project: string) {
  const set = useSetFollowUp(project);
  const resume = (r: FollowUpDto) => set.mutate({ clientId: r.clientId, body: { action: "resume" } });
  return {
    pending: set.isPending,
    error: set.isError ? sentence(set.error) : null,
    date: (r: FollowUpDto, nextAt: string, done?: () => void) => set.mutate({ clientId: r.clientId, body: { action: "date", nextAt } }, { onSuccess: () => done?.() }),
    stop: (r: FollowUpDto) =>
      set.mutate(
        { clientId: r.clientId, body: { action: "stop" } },
        { onSuccess: () => toastManager.add({ title: `Follow-ups stopped for ${r.name}`, type: "success", actionProps: { children: "Undo", onClick: () => resume(r) } }) },
      ),
    resume,
  };
}

type Moves = ReturnType<typeof useFollowUpMoves>;

/** Change date: a date field in a popover anchored to the control that opened it; today or later, saved on Save. */
export function ChangeDate({ r, moves, open, onOpenChange, anchor }: { r: FollowUpDto; moves: Moves; open: boolean; onOpenChange: (open: boolean) => void; anchor: RefObject<HTMLElement | null> }) {
  const id = useId();
  const today = localDay(useClock()());
  const [value, setValue] = useState(r.nextAt?.slice(0, 10) ?? "");
  const ok = validDate(value, today);
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverPopup align="end" anchor={anchor}>
        <PopoverTitle>Next follow-up for {r.name}</PopoverTitle>
        <PopoverDescription>The agent looks again on this day; until then nothing is drafted.</PopoverDescription>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) moves.date(r, value, () => onOpenChange(false));
          }}
        >
          <Field htmlFor={id} label="Day">
            <Input aria-invalid={value !== "" && !ok ? true : undefined} id={id} min={today} onChange={(e) => setValue(e.target.value)} type="date" value={value} />
          </Field>
          <p className="text-destructive-foreground text-xs" role="alert">
            {value !== "" && !ok ? "Pick today or a later day." : (moves.error ?? "")}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <PopoverClose render={<ActionButton size="s" variant="quiet" />}>Cancel</PopoverClose>
            <ActionButton disabled={!ok || moves.pending} size="s" type="submit" variant="primary">
              {moves.pending ? "Saving" : "Save date"}
            </ActionButton>
          </div>
        </form>
      </PopoverPopup>
    </Popover>
  );
}
