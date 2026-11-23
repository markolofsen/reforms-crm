import { Children, type ReactNode, type Ref } from "react";
import { ArrowDownIcon, ArrowLeftIcon } from "lucide-react";
import { cn } from "../cn";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ActionButton } from "./action-button";

/** The shared fixed-height conversation skeleton used by Mail and Messengers. */
export function ConversationFrame({ ariaLabel, children, composer, header, historyActions, className, dataAgentRef, dataState, testId }: {
  ariaLabel: string;
  children: ReactNode;
  composer?: ReactNode;
  header: ReactNode;
  historyActions?: ReactNode;
  className?: string;
  dataAgentRef?: string;
  dataState?: string;
  testId?: string;
}) {
  return (
    <article aria-label={ariaLabel} className={cn("flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background", className)} data-agent-ref={dataAgentRef} data-state={dataState} data-testid={testId}>
      <div className="shrink-0" data-slot="conversation-header">{header}</div>
      <div className="relative min-h-0 flex-1">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region is focusable so the keyboard can scroll it (axe scrollable-region-focusable) */}
        <div aria-label="Conversation history" className={cn("h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]", historyActions && "pb-16")} data-pane="history" role="region" tabIndex={0}>{children}</div>
        {historyActions && <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-4"><div className="pointer-events-auto">{historyActions}</div></div>}
      </div>
      {composer && (
        <div className="flex max-h-[min(44%,28rem)] min-h-0 shrink-0 flex-col overflow-hidden overscroll-contain border-t bg-muted/10 [scrollbar-gutter:stable]" data-pane="composer">
          <div className="min-h-0 flex-1" data-slot="composer-content">{composer}</div>
        </div>
      )}
    </article>
  );
}

/** The one full-height content adapter inside the history scroll owner. Querying features may attach their ref here. */
export function ConversationHistoryContent({ ariaBusy, ariaLabel, children, className, dataSource, historyRef, testId }: {
  ariaBusy?: boolean;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  dataSource?: string;
  historyRef?: Ref<HTMLElement>;
  testId?: string;
}) {
  return <section aria-busy={ariaBusy || undefined} aria-label={ariaLabel} className={cn("flex min-h-full min-w-0 flex-col", className)} data-source={dataSource} data-testid={testId} ref={historyRef}>{children}</section>;
}

/** Appears only after the owner reads older messages and offers one clear path back to the newest content. */
export function ConversationScrollToLatest({ onClick, label = "Latest" }: { onClick: () => void; label?: string }) {
  return (
    <ActionButton aria-label="Scroll to latest messages" onClick={onClick} size="s" tooltip={{ content: "Scroll to latest messages" }} variant="secondary">
      <ArrowDownIcon aria-hidden="true" />
      {label}
    </ActionButton>
  );
}

/** Centers loading, empty, and error content across the full conversation history pane. */
export function ConversationHistoryState({ children, className, flush = false }: { children: ReactNode; className?: string; flush?: boolean }) {
  return <div className={cn("flex min-h-full min-w-0 items-center justify-center p-6", flush && "p-0", className)} data-slot="conversation-history-state">{children}</div>;
}

export function ConversationEmptyState({ ariaLabel = "Conversation", children, subtitle, title = "Conversation" }: { ariaLabel?: string; children: ReactNode; subtitle: ReactNode; title?: ReactNode }) {
  return (
    <ConversationFrame ariaLabel={ariaLabel} header={<ConversationHeader subtitle={subtitle} title={title} />}>
      <ConversationHistoryState flush>{children}</ConversationHistoryState>
    </ConversationFrame>
  );
}

/** The shared inset for a refresh warning that stays inside the one history scroll surface. */
export function ConversationHistoryNotice({ children }: { children: ReactNode }) {
  return <div className="shrink-0 px-4 pt-3 lg:px-6" data-slot="conversation-history-notice">{children}</div>;
}

/** A quiet, shared summary at the top of a history when older content is outside the loaded window. */
export function ConversationHistorySummary({ children }: { children: ReactNode }) {
  return <p className="shrink-0 border-b px-4 py-2 text-muted-foreground text-xs lg:px-6" data-slot="conversation-history-summary">{children}</p>;
}

/** Keeps the last readable history visible while a refresh is retried. */
export function ConversationStaleNotice({ detail, onRetry, retrying = false }: { detail?: ReactNode; onRetry: () => void; retrying?: boolean }) {
  return (
    <Alert variant="warning">
      <AlertTitle>Showing the last conversation that loaded</AlertTitle>
      {detail && <AlertDescription>{detail}</AlertDescription>}
      <AlertAction>
        <ActionButton disabled={retrying} onClick={onRetry} size="s" variant="secondary">{retrying ? "Retrying…" : "Retry"}</ActionButton>
      </AlertAction>
    </Alert>
  );
}

/** A non-blocking status that stays at the top of the one history scroll while fresh messages are requested. */
export function ConversationRefreshing() {
  return (
    <div aria-live="polite" className="pointer-events-none sticky top-0 z-10 flex justify-end px-4 pt-2 lg:px-6" data-slot="conversation-refreshing" role="status">
      <span className="inline-flex items-center gap-1.5 rounded-md border bg-background/95 px-2 py-1 text-muted-foreground text-xs">
        <Spinner aria-hidden="true" className="size-3" />
        Updating conversation…
      </span>
    </div>
  );
}

/** The one mobile escape action for a split conversation; desktop keeps the list visible beside the detail. */
export function ConversationBackButton({ label = "Back", onClick, onRestoreFocus }: { label?: string; onClick: () => void; onRestoreFocus?: () => void }) {
  const handleClick = () => {
    onClick();
    if (onRestoreFocus) window.requestAnimationFrame(onRestoreFocus);
  };
  return (
    <ActionButton aria-label={label} className="@3xl:hidden" onClick={handleClick} size="s" variant="quiet">
      <ArrowLeftIcon aria-hidden="true" />
      {label}
    </ActionButton>
  );
}

/** Keeps optional identity facts separated consistently in Mail and Messenger headers. */
export function ConversationHeaderFacts({ children }: { children: ReactNode }) {
  const facts = Children.toArray(children);
  return (
    <>
      {facts.map((fact, index) => (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1" key={index}>
          {index > 0 && <span aria-hidden="true">·</span>}
          {fact}
        </span>
      ))}
    </>
  );
}

/** The one composer layout: notices stay visible, the body scrolls, and actions stay pinned below it. */
export function ConversationComposer({ ariaLabel, children, footer, notice, className, state }: {
  ariaLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  notice?: ReactNode;
  className?: string;
  state?: string;
}) {
  return (
    <section aria-label={ariaLabel} className={cn("flex h-full min-h-0 flex-col", className)} data-composer-state={state}>
      {notice && <div className="flex shrink-0 flex-col gap-1 border-b px-3 py-1.5 lg:px-4" data-slot="composer-notice">{notice}</div>}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-2 lg:px-4" data-slot="composer-body">{children}</div>
      {footer && <div className="shrink-0 border-t bg-background px-3 py-2 lg:px-4" data-slot="composer-actions">{footer}</div>}
    </section>
  );
}

/** The stable action rhythm shared by manual Mail and Messenger composers. */
export function ConversationComposerFooter({ feedback, children }: { feedback?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {feedback && <div className="basis-full min-w-0" data-slot="composer-feedback">{feedback}</div>}
      {children}
    </div>
  );
}

function HeaderTitle({ title }: { title: ReactNode }) {
  const label = typeof title === "string" ? title : null;
  const heading = <h2 className="min-w-0 truncate font-semibold text-base">{title}</h2>;
  if (!label) return heading;
  return (
    <Tooltip>
      <TooltipTrigger aria-label={label} render={heading} />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** A compact, stable header: identity on the left, context below it, actions on the right. */
export function ConversationHeader({ title, subtitle, back, actions }: { title: ReactNode; subtitle?: ReactNode; back?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="@container flex min-h-14 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-background px-4 py-2 lg:gap-x-3 lg:px-6" data-slot="conversation-header-bar">
      {back}
      <div className="min-w-0 flex-[1_1_12rem] py-0.5">
        <HeaderTitle title={title} />
        {subtitle && <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 break-words text-muted-foreground text-xs">{subtitle}</div>}
      </div>
      {actions && <div className="ms-auto flex min-w-0 max-w-full shrink-0 flex-wrap items-center justify-end gap-1 @3xl:max-w-[min(50%,24rem)]">{actions}</div>}
    </header>
  );
}
