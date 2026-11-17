import type * as React from "react";
import { cn } from "../cn";

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
