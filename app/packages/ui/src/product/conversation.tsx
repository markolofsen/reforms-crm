import type { ReactNode } from "react";
import { cn } from "../cn";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type ConversationTextFormat = "plain" | "markdown";

export function ConversationLabel({ value, className }: { value: string; className?: string }) {
  const content = <span className={className}>{value}</span>;
  if (value.length <= 20) return content;
  return (
    <Tooltip>
      <TooltipTrigger aria-label={value} render={content} />
      <TooltipPopup className="max-w-[min(24rem,calc(100vw-2rem))]">{value}</TooltipPopup>
    </Tooltip>
  );
}

/** The shared message-list wrapper; individual rows own direction, spacing and bubble semantics. */
export function ConversationMessageList({ ariaLabel = "Messages", children, className }: { ariaLabel?: string; children: ReactNode; className?: string }) {
  return <ul aria-label={ariaLabel} className={cn("flex min-w-0 flex-col gap-1 py-2", className)}>{children}</ul>;
}

export function ConversationList({ ariaLabel, children, className }: { ariaLabel: string; children: ReactNode; className?: string }) {
  return <ul aria-label={ariaLabel} className={cn("flex min-w-0 flex-col", className)} data-slot="conversation-list">{children}</ul>;
}

/** The shared compact row shell for Mail and Messenger contact lists. Feature rows provide only their domain content and actions. */
export function ConversationListItem({ ariaLabel, children, className, dataAgentRef, dataAttributes, id, open = false, selected = false }: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  dataAgentRef?: string;
  dataAttributes?: Readonly<Record<string, string | number | boolean | undefined>>;
  id?: string;
  open?: boolean;
  selected?: boolean;
}) {
  return (
    <li
      {...dataAttributes}
      aria-label={ariaLabel}
      className={cn("group/list-item relative min-h-16 min-w-0 border-b border-border/70 transition-colors", open ? "bg-accent hover:bg-accent/80" : selected ? "bg-info/8 hover:bg-info/12" : "hover:bg-muted/50", className)}
      data-agent-ref={dataAgentRef}
      data-open={open}
      data-selected={selected}
      id={id}
    >
      {open && <span aria-hidden="true" className="absolute inset-y-0 start-0 w-0.5 bg-primary" />}
      {children}
    </li>
  );
}

/** The shared first line of Mail and Messenger contact rows: identity, optional integration marker and newest activity time. */
export function ConversationListIdentity({ leading, marker, name, nameClassName, time }: { leading?: ReactNode; marker?: ReactNode; name: ReactNode; nameClassName?: string; time?: ReactNode }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-2" data-slot="conversation-list-identity">
      {leading}
      {marker}
      <span className={cn("min-w-0 flex-1 truncate font-medium", nameClassName)}>{name}</span>
      {time && <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{time}</span>}
    </span>
  );
}

/** A quiet day boundary that stays inside the shared message list and does not add another scroll surface. */
export function ConversationDayDivider({ label }: { label: string }) {
  return (
    <li aria-label={label} className="flex min-w-0 items-center gap-3 px-4 py-3 text-muted-foreground text-[11px]" data-slot="conversation-day-divider">
      <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />
      <span className="shrink-0 rounded-full bg-muted/60 px-2 py-1 font-medium">{label}</span>
      <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />
    </li>
  );
}

function safeHref(value: string): string | null {
  if (value.startsWith("/") || value.startsWith("#")) return value;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" || protocol === "tel:" ? value : null;
  } catch {
    return null;
  }
}

function plainText(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /https?:\/\/[^\s<>()]+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const trailing = token.match(/[.,!?;:]+$/)?.[0] ?? "";
    const value = trailing ? token.slice(0, -trailing.length) : token;
    const href = safeHref(value);
    if (href) {
      parts.push(<a className="underline underline-offset-2" href={href} key={`${match.index}-url`} rel="noreferrer" target="_blank">{value}</a>);
      if (trailing) parts.push(trailing);
    } else parts.push(token);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function inlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\([^\s)]+\)|\*[^*\n]+\*|_[^_\n]+_|https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) parts.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("~~")) parts.push(<del key={`${match.index}-strike`}>{token.slice(2, -2)}</del>);
    else if (token.startsWith("`")) parts.push(<code className="rounded bg-muted px-1" key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("*") || token.startsWith("_")) parts.push(<em key={`${match.index}-em`}>{token.slice(1, -1)}</em>);
    else if (token.startsWith("http://") || token.startsWith("https://")) {
      const trailing = token.match(/[.,!?;:]+$/)?.[0] ?? "";
      const value = trailing ? token.slice(0, -trailing.length) : token;
      const href = safeHref(value);
      if (href) {
        parts.push(<a className="underline" href={href} key={`${match.index}-url`} rel="noreferrer" target="_blank">{value}</a>);
        if (trailing) parts.push(trailing);
      } else parts.push(token);
    } else {
      const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(token);
      const href = link ? safeHref(link[2] ?? "") : null;
      if (link && href) parts.push(<a className="underline" href={href} key={`${match.index}-link`} rel="noreferrer" target="_blank">{link[1]}</a>);
      else parts.push(token);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function ConversationText({ text, format = "plain" }: { text: string; format?: ConversationTextFormat }) {
  if (format === "plain") return <p className="whitespace-pre-wrap break-words text-sm leading-6">{plainText(text)}</p>;
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: { kind: "ul" | "ol"; items: ReactNode[] } | null = null;
  let code: string[] | null = null;
  let paragraph: string[] = [];
  let quote: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(<p className="whitespace-pre-wrap break-words text-sm leading-6" key={`paragraph-${blocks.length}`}>{inlineMarkdown(paragraph.join("\n"))}</p>);
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push(
      <blockquote className="rounded-lg bg-muted px-3 py-2 text-muted-foreground" key={`quote-${blocks.length}`}>
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{inlineMarkdown(quote.join("\n"))}</p>
      </blockquote>,
    );
    quote = [];
  };
  const flushText = () => {
    flushParagraph();
    flushQuote();
  };
  const flushList = () => {
    if (list !== null && list.items.length > 0) {
      const List = list.kind;
      blocks.push(<List className={cn(list.kind === "ul" ? "list-disc" : "list-decimal", "space-y-1 ps-5")} key={`list-${blocks.length}`}>{list.items}</List>);
    }
    list = null;
  };
  for (const [index, line] of lines.entries()) {
    if (line.startsWith("```")) {
      if (code === null) {
        flushText();
        flushList();
        code = [];
      } else {
        blocks.push(<pre className="overflow-x-auto rounded bg-muted p-2 text-xs" key={`code-${index}`}><code>{code.join("\n")}</code></pre>);
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushText();
      if (list?.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(<li key={`item-${index}`}>{inlineMarkdown(line.slice(2))}</li>);
      continue;
    }
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushText();
      flushList();
      blocks.push(<hr className="border-border" key={`rule-${index}`} />);
      continue;
    }
    if (line === ">" || line.startsWith("> ")) {
      flushParagraph();
      flushList();
      quote.push(line.slice(1).trimStart());
      continue;
    }
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      flushText();
      if (list?.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(<li key={`item-${index}`}>{inlineMarkdown(ordered[1] ?? "")}</li>);
      continue;
    }
    if (!line) {
      flushText();
      flushList();
      continue;
    }
    flushQuote();
    flushList();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const content = inlineMarkdown(heading[2] ?? "");
      if ((heading[1] ?? "").length === 1) blocks.push(<h3 className="font-semibold text-base" key={`heading-${index}`}>{content}</h3>);
      else if ((heading[1] ?? "").length === 2) blocks.push(<h4 className="font-semibold text-sm" key={`heading-${index}`}>{content}</h4>);
      else blocks.push(<h5 className="font-semibold text-sm text-muted-foreground" key={`heading-${index}`}>{content}</h5>);
    } else paragraph.push(line);
  }
  if (code !== null) blocks.push(<pre className="overflow-x-auto rounded bg-muted p-2 text-xs" key={`code-${blocks.length}`}><code>{code.join("\n")}</code></pre>);
  flushText();
  flushList();
  return <div className="flex flex-col gap-2">{blocks}</div>;
}

export function ConversationMessage({ author, time, dateTime, meta, direction, hidden, header, children, className, bubbleClassName, focusRef, id, ours, testId }: {
  author?: string;
  time?: string;
  dateTime?: string;
  meta?: string;
  direction?: "in" | "out";
  hidden?: string | null;
  header?: ReactNode;
  children: ReactNode;
  className?: string;
  bubbleClassName?: string;
  focusRef?: string;
  id?: string;
  ours?: boolean;
  testId?: string;
}) {
  const resolvedDirection = direction ?? (ours === true ? "out" : ours === false ? "in" : undefined);
  const outgoing = resolvedDirection === "out";
  const bubble = cn(
    "min-w-0 max-w-[min(48rem,88%)] rounded-2xl border px-4 py-3 shadow-xs sm:max-w-[78%]",
    outgoing ? "ms-auto rounded-tr-md border-info/45 bg-info/20 text-foreground dark:bg-info/30" : "me-auto rounded-tl-md border-border/70 bg-muted/65 text-foreground",
  );
  const metaText = outgoing ? "text-info-foreground" : "text-muted-foreground";
  return (
    <li {...(focusRef ? { "data-agent-ref": focusRef } : {})} className={cn("flex min-w-0 px-4 py-1.5 lg:px-6", outgoing ? "justify-end" : "justify-start", className)} data-direction={resolvedDirection} data-ours={resolvedDirection === undefined ? undefined : outgoing} data-sender={outgoing ? "you" : "contact"} data-testid={testId} id={id}>
      {header ? (
        <div className={cn(bubble, bubbleClassName)} data-bubble-direction={resolvedDirection}>{header}{children}</div>
      ) : (
        <div className={cn(bubble, bubbleClassName)} data-bubble-direction={resolvedDirection}>
          <div className="mb-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            {author && <ConversationLabel className={cn("min-w-0 max-w-[45%] truncate font-medium", outgoing ? metaText : "text-foreground")} value={author} />}
            {meta && <ConversationLabel className={cn("min-w-0 max-w-full flex-1 truncate", metaText)} value={meta} />}
            {time && <time className={cn("shrink-0", metaText)} dateTime={dateTime}>{time}</time>}
          </div>
          <div className="min-w-0">
            {children}
            {hidden && <p className={cn("mt-1 text-xs", metaText)}>hidden from agent: {hidden}</p>}
          </div>
        </div>
      )}
    </li>
  );
}
