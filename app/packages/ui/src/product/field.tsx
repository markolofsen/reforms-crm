"use client";

import type * as React from "react";
import { useState } from "react";
import { cn } from "../cn";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

/** A label above a control, with an optional hint under it. `htmlFor` ties it to the control's id. */
export function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label className="font-medium text-sm" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/** A thin bar with its numbers read out for assistive tech. `value` of `max`. */
export function Progress({ value, max, label, className }: { value: number; max: number; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div aria-label={label} aria-valuemax={max} aria-valuemin={0} aria-valuenow={value} className={cn("h-1.5 w-full overflow-hidden rounded-full bg-secondary", className)} role="progressbar">
      <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** What a saving control is told by its command (`useCommand`): whether the save runs and, after a failure, its sentence. */
export type SaveState = { pending: boolean; error?: string | null };

/**
 * An owner setting that saves on change (P127 B1, V10): the switch is disabled while its save runs and a failure is said under
 * it, so "disabled while pending, the failure inline" (state rule 6) holds by construction. The label around it is the 44 px
 * touch target below 1024 px. A caller with one live region for its whole group passes no `error` and says it there.
 */
export function SettingSwitch({ id, checked, onChange, pending, error, disabled, label, labelledBy, describedBy }: SaveState & { id?: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; label?: string; labelledBy?: string; describedBy?: string }) {
  return (
    <span className="inline-flex min-w-0 flex-col gap-0.5">
      <label className="flex min-h-11 cursor-pointer items-center lg:min-h-0" htmlFor={id}>
        <Switch aria-busy={pending || undefined} aria-describedby={describedBy} aria-label={label} aria-labelledby={labelledBy} checked={checked} disabled={disabled || pending} id={id} onCheckedChange={onChange} />
      </label>
      {error && (
        <span className="text-destructive-foreground text-xs" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * A field that saves when it is left or Enter is pressed, and only when its trimmed value changed (P127 B1, V10). `onCommit`
 * returning false refuses the text and puts the stored value back. Disabled while the save runs, its failure said under it.
 * The stored value is the `value` prop: a caller keys the field on it, so a saved or refreshed value replaces the typed text.
 */
export function CommitField({ id, value, onCommit, pending, error, disabled, label, className, inputMode, placeholder, list }: SaveState & { id: string; value: string; onCommit: (v: string) => boolean | void; disabled?: boolean; label?: string; className?: string; inputMode?: "numeric"; placeholder?: string; list?: string }) {
  const [text, setText] = useState(value);
  const commit = () => {
    const next = text.trim();
    if (next !== value && onCommit(next) === false) setText(value);
  };
  return (
    <span className="inline-flex min-w-0 flex-col gap-0.5">
      <Input
        aria-busy={pending || undefined}
        aria-label={label}
        className={cn("control-m", className)}
        disabled={disabled || pending}
        id={id}
        inputMode={inputMode}
        list={list}
        onBlur={commit}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        placeholder={placeholder}
        value={text}
      />
      {error && (
        <span className="text-destructive-foreground text-xs" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
