"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "../../cn";
import { Textarea } from "../../ui/textarea";

// The composers' editor until P93's RTF write and canonical read-back land (P123 U0, decision 0045 point 3): plain text in,
// the same plain text out. No formatting buttons, and a paste arrives as plain text (a textarea holds no markup), so no
// bold word can reach a client's inbox as `**word**`. Text that already holds Markdown is shown raw, as it would be sent.

export type PlainTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  id?: string;
  showMeta?: boolean;
  className?: string;
};

export function PlainTextEditor({ value, onChange, onSubmit, onCancel, placeholder = "Write your reply…", ariaLabel = "Reply", disabled = false, maxLength, autoFocus = false, id, showMeta = true, className }: PlainTextEditorProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const editorId = useId();
  const helpId = `${id ?? `plain-editor-${editorId.replaceAll(":", "")}`}-help`;
  // Focus follows the owner's click that opened the editor (an effect after mount), never a page load.
  useEffect(() => {
    if (!autoFocus || !field.current) return;
    const el = field.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  return (
    <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background ring-ring/24 has-focus-visible:border-ring has-focus-visible:ring-[3px]", disabled && "opacity-60", className)} data-editor="plain-text" data-testid="plain-text-editor">
      <span className="sr-only" id={helpId}>
        Plain text. {onSubmit ? "Meta or Control plus Enter saves." : "Saving is controlled by the surrounding actions."} {onCancel ? "Escape cancels editing." : ""}
      </span>
      <Textarea
        aria-describedby={helpId}
        aria-keyshortcuts={[onSubmit ? "Meta+Enter" : null, onSubmit ? "Control+Enter" : null, onCancel ? "Escape" : null].filter(Boolean).join(" ") || undefined}
        aria-label={ariaLabel}
        className="rounded-none border-0 shadow-none before:hidden has-focus-visible:ring-0 [&_textarea]:min-h-28"
        disabled={disabled}
        id={id}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && onSubmit) {
            event.preventDefault();
            onSubmit();
          } else if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        ref={field}
        value={value}
      />
      {showMeta && <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-1.5 text-muted-foreground text-xs">
        <span>Plain text, saved as written. Nothing is sent from this editor.</span>
        <span>{value.length}{maxLength ? `/${maxLength}` : ""}{onSubmit ? " · Meta/Ctrl + Enter saves" : ""}{onCancel ? " · Esc cancels" : ""}</span>
      </div>}
    </div>
  );
}
