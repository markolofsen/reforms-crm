import { RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@hub/ui/alert";
import { ActionButton } from "@hub/ui/product/action-button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@hub/ui/empty";
import { Skeleton } from "@hub/ui/skeleton";
import { Spinner } from "@hub/ui/spinner";
import { sentence } from "@/lib/api/client";

// The four states every list and mutation has (rules: ui-specifications): loading, empty, error with Retry, stale.

export function Loading({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
      <Spinner aria-hidden="true" />
      Loading {what}...
    </p>
  );
}

export function Refreshing() {
  return (
    <span aria-live="polite" className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs" role="status">
      <Spinner aria-hidden="true" className="size-3" />
      Updating
    </span>
  );
}

export function LoadFailed({ what, error, onRetry, retrying }: { what: string; error: unknown; onRetry: () => void; retrying?: boolean }) {
  return (
    <Alert variant="error">
      <AlertTitle>Could not load {what}</AlertTitle>
      <AlertDescription>{sentence(error)}</AlertDescription>
      <AlertAction>
        <ActionButton disabled={retrying} onClick={onRetry} size="s" variant="secondary">
          <RefreshCwIcon aria-hidden="true" />
          Retry
        </ActionButton>
      </AlertAction>
    </Alert>
  );
}

/** The list on screen is the last one that loaded: a refresh failed since. */
export function StaleNote({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  return (
    <Alert variant="warning">
      <AlertTitle>Showing the last list that loaded</AlertTitle>
      <AlertDescription>{sentence(error)}</AlertDescription>
      <AlertAction>
        <ActionButton disabled={retrying} onClick={onRetry} size="s" variant="secondary">
          Retry
        </ActionButton>
      </AlertAction>
    </Alert>
  );
}

/** Rows the shape of the list that is coming, so the page does not jump when it arrives. */
export function ListSkeleton({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <ul aria-busy="true" aria-label={label} className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <li className="flex h-16 items-center gap-3 border-b px-3" key={i}>
          <Skeleton className="size-5 rounded-full" />
          <span className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Compact chrome for retry and stale notices inside a scrolling list column. */
export function ListState({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div className="flex shrink-0 flex-col gap-2 px-3 py-3" data-testid={testId}>{children}</div>;
}

export function EmptyState({ title, children, action, compact = false }: { title: string; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <Empty className={compact ? "gap-4 px-4 py-8 md:py-12" : undefined}>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
      {action}
    </Empty>
  );
}
