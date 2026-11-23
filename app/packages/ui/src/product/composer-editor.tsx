import type { ReactNode } from "react";
import { cn } from "../cn";
import { ConversationComposer } from "./conversation-frame";
import { MarkdownEditor } from "./markdown-editor";

export type ConversationEditorSurfaceProps = {
  ariaLabel: string;
  title: ReactNode;
  description?: ReactNode;
  beforeEditor?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  showEditorMeta?: boolean;
  testId?: string;
  className?: string;
};

type ConversationComposerEditorProps = ConversationEditorSurfaceProps & {
  notice?: ReactNode;
  footer?: ReactNode;
  state?: string;
};

export function ConversationEditorSurface({ ariaLabel, title, description, beforeEditor, value, onChange, onSubmit, onCancel, placeholder, disabled = false, maxLength, autoFocus = false, showEditorMeta = false, testId, className }: ConversationEditorSurfaceProps) {
  return <div className={cn("flex min-w-0 flex-col gap-2", className)} data-testid={testId}>
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="font-medium text-sm">{title}</h3>
      {description && <p className="text-muted-foreground text-xs">{description}</p>}
    </div>
    {beforeEditor}
    {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the editor opens on the owner's Edit click and focuses itself in an effect, never on page load */}
    <MarkdownEditor ariaLabel={ariaLabel} autoFocus={autoFocus} disabled={disabled} maxLength={maxLength} onCancel={onCancel} onChange={onChange} onSubmit={onSubmit} placeholder={placeholder} showMeta={showEditorMeta} toolbarPreset="mail" value={value} />
  </div>;
}

export function ConversationComposerEditor({ beforeEditor, notice, footer, state, ...surface }: ConversationComposerEditorProps) {
  return (
    <ConversationComposer ariaLabel={surface.ariaLabel} footer={footer} notice={notice} state={state}>
      <ConversationEditorSurface {...surface} beforeEditor={beforeEditor} />
    </ConversationComposer>
  );
}
