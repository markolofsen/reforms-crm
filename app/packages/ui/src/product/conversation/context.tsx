import type { ReactNode } from "react";
import { cn } from "../../cn";

/** Compact, wrapping context surface for the shared Mail and Messenger composers. */
export function ConversationContext({ ariaLabel = "Conversation context", children, className, testId }: { ariaLabel?: string; children: ReactNode; className?: string; testId?: string }) {
  return (
    <div aria-label={ariaLabel} className={cn("flex min-w-0 flex-col gap-1.5 rounded-md border bg-muted/20 px-3 py-2 text-muted-foreground text-xs break-words", className)} data-slot="conversation-context" data-testid={testId} role="group">
      {children}
    </div>
  );
}

/** The compact facts row inside the composer context surface. */
export function ConversationContextRow({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <div className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1", className)} data-slot="conversation-context-row" data-testid={testId}>{children}</div>;
}

/** A separate recovery/action row keeps warnings from competing with context facts. */
export function ConversationContextActions({ children, className, testId, tone = "neutral" }: { children: ReactNode; className?: string; testId?: string; tone?: "neutral" | "warning" }) {
  return <div className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t pt-1.5 break-words", tone === "warning" ? "text-warning-foreground" : "text-muted-foreground", className)} data-slot="conversation-context-actions" data-testid={testId}>{children}</div>;
}

/** One labelled fact inside a conversation context surface. */
export function ConversationContextItem({ label, children, className, testId }: { label: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-1", className)} data-slot="conversation-context-item" data-testid={testId}>
      <span className="shrink-0 text-foreground/70">{label}:</span>
      <span className="min-w-0 max-w-full break-words">{children}</span>
    </div>
  );
}
