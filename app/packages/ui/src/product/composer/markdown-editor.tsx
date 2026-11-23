"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import type { AnyExtension } from "@tiptap/core";
import { BoldIcon, Code2Icon, Heading1Icon, Heading2Icon, Heading3Icon, ItalicIcon, LinkIcon, ListIcon, ListOrderedIcon, MinusIcon, QuoteIcon, Redo2Icon, StrikethroughIcon, Undo2Icon, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../cn";
import { Input } from "../../ui/input";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { ActionButton } from "../action-button";

export type MarkdownEditorProps = {
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
  toolbarPreset?: MarkdownEditorToolbarPreset;
  className?: string;
};

export type MarkdownEditorToolbarPreset = "full" | "mail";

function markdownOf(editor: Editor): string { return editor.getMarkdown(); }

type MarkdownToolbarActionId = "heading-1" | "heading-2" | "heading-3" | "quote" | "code-block" | "horizontal-rule" | "bold" | "italic" | "strike" | "inline-code" | "link" | "bullet-list" | "ordered-list" | "undo" | "redo";

type ToolbarAction = {
  id: MarkdownToolbarActionId;
  group: "block" | "inline" | "lists" | "history";
  label: string;
  icon: LucideIcon;
  toggle?: boolean;
  active: (editor: Editor) => boolean;
  available?: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
};

const toolbarActions: ToolbarAction[] = [
  { id: "heading-1", group: "block", label: "Heading 1", icon: Heading1Icon, toggle: true, active: (editor) => editor.isActive("heading", { level: 1 }), run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: "heading-2", group: "block", label: "Heading 2", icon: Heading2Icon, toggle: true, active: (editor) => editor.isActive("heading", { level: 2 }), run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: "heading-3", group: "block", label: "Heading 3", icon: Heading3Icon, toggle: true, active: (editor) => editor.isActive("heading", { level: 3 }), run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: "quote", group: "block", label: "Quote", icon: QuoteIcon, toggle: true, active: (editor) => editor.isActive("blockquote"), run: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { id: "code-block", group: "block", label: "Code block", icon: Code2Icon, toggle: true, active: (editor) => editor.isActive("codeBlock"), run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
  { id: "horizontal-rule", group: "block", label: "Horizontal rule", icon: MinusIcon, active: () => false, run: (editor) => editor.chain().focus().setHorizontalRule().run() },
  { id: "bold", group: "inline", label: "Bold", icon: BoldIcon, toggle: true, active: (editor) => editor.isActive("bold"), run: (editor) => editor.chain().focus().toggleBold().run() },
  { id: "italic", group: "inline", label: "Italic", icon: ItalicIcon, toggle: true, active: (editor) => editor.isActive("italic"), run: (editor) => editor.chain().focus().toggleItalic().run() },
  { id: "strike", group: "inline", label: "Strikethrough", icon: StrikethroughIcon, toggle: true, active: (editor) => editor.isActive("strike"), run: (editor) => editor.chain().focus().toggleStrike().run() },
  { id: "inline-code", group: "inline", label: "Inline code", icon: Code2Icon, toggle: true, active: (editor) => editor.isActive("code"), run: (editor) => editor.chain().focus().toggleCode().run() },
  { id: "link", group: "inline", label: "Link", icon: LinkIcon, active: (editor) => editor.isActive("link"), run: () => undefined },
  { id: "bullet-list", group: "lists", label: "Bulleted list", icon: ListIcon, toggle: true, active: (editor) => editor.isActive("bulletList"), run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { id: "ordered-list", group: "lists", label: "Numbered list", icon: ListOrderedIcon, toggle: true, active: (editor) => editor.isActive("orderedList"), run: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { id: "undo", group: "history", label: "Undo", icon: Undo2Icon, active: () => false, available: (editor) => editor.can().chain().focus().undo().run(), run: (editor) => editor.chain().focus().undo().run() },
  { id: "redo", group: "history", label: "Redo", icon: Redo2Icon, active: () => false, available: (editor) => editor.can().chain().focus().redo().run(), run: (editor) => editor.chain().focus().redo().run() },
];

const MAIL_TOOLBAR_ACTIONS = new Set<MarkdownToolbarActionId>(["quote", "bold", "italic", "link", "bullet-list", "ordered-list", "undo", "redo"]);

function toolbarActionsFor(preset: MarkdownEditorToolbarPreset) {
  return preset === "mail" ? toolbarActions.filter(({ id }) => MAIL_TOOLBAR_ACTIONS.has(id)) : toolbarActions;
}

function LinkControl({ editor, disabled, open, value, error, onOpen, onClose, onChange, onApply, onRemove }: { editor: Editor | null; disabled: boolean; open: boolean; value: string; error: string | null; onOpen: () => void; onClose: () => void; onChange: (value: string) => void; onApply: () => void; onRemove: () => void }) {
  const current = editor?.getAttributes("link").href ?? "";
  // The popover opens on the owner's click, so focus moves into its URL field (Base UI's initial focus, not the DOM autofocus).
  const urlField = useRef<HTMLInputElement>(null);
  return (
    <Popover onOpenChange={(next) => !next && onClose()} open={open}>
      <PopoverTrigger render={<ActionButton aria-label="Link" disabled={disabled || editor === null} icon onClick={onOpen} onMouseDown={(event) => event.preventDefault()} size="s" tooltip={{ content: "Add or edit link" }} variant={open ? "secondary" : "quiet"} />}>
        <LinkIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-80" initialFocus={urlField}>
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-medium text-sm">{current ? "Edit link" : "Add link"}</p>
            <p className="text-muted-foreground text-xs">Use an HTTP, mailto or tel URL.</p>
          </div>
          <Input aria-label="Link URL" onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onApply(); } if (event.key === "Escape") { event.preventDefault(); onClose(); } }} placeholder="https://example.com" ref={urlField} type="url" value={value} />
          {error && <p className="text-destructive-foreground text-xs" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {current && <ActionButton onClick={onRemove} size="s" variant="quiet">Remove</ActionButton>}
            <PopoverClose render={<ActionButton size="s" variant="quiet" />}>Cancel</PopoverClose>
            <ActionButton disabled={!value.trim() || error !== null} onClick={onApply} size="s" variant="primary">Apply</ActionButton>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function EditorToolbar({ editor, disabled, linkOpen, linkValue, linkError, onLinkOpen, onLinkClose, onLinkChange, onLinkApply, onLinkRemove, preset }: { editor: Editor | null; disabled: boolean; linkOpen: boolean; linkValue: string; linkError: string | null; onLinkOpen: () => void; onLinkClose: () => void; onLinkChange: (value: string) => void; onLinkApply: () => void; onLinkRemove: () => void; preset: MarkdownEditorToolbarPreset }) {
  const actions = toolbarActionsFor(preset);
  return (
    <div aria-label={preset === "mail" ? "Mail formatting" : "Markdown formatting"} className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-2 py-1.5" role="toolbar">
      {actions.map(({ id, group, label, icon: Icon, toggle, active, available, run }, index) => {
        const previous = actions[index - 1];
        const separator = previous && previous.group !== group ? <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" /> : null;
        if (id === "link") return <Fragment key={label}>{separator}<LinkControl disabled={disabled} editor={editor} error={linkError} onApply={onLinkApply} onChange={onLinkChange} onClose={onLinkClose} onOpen={onLinkOpen} onRemove={onLinkRemove} open={linkOpen} value={linkValue} /></Fragment>;
        const pressed = editor !== null && active(editor);
        return (
          <Fragment key={label}>
            {separator}
            <ActionButton
              aria-label={label}
              aria-pressed={toggle ? pressed : undefined}
              className={cn("text-muted-foreground", pressed && "bg-accent text-foreground")}
              disabled={disabled || editor === null || (editor !== null && available !== undefined && !available(editor))}
              icon
              onClick={() => editor !== null && run(editor)}
              onMouseDown={(event) => event.preventDefault()}
              size="s"
              tooltip={{ content: label }}
              type="button"
              variant="quiet"
            >
              <Icon aria-hidden="true" />
            </ActionButton>
          </Fragment>
        );
      })}
    </div>
  );
}

export function MarkdownEditor({ value, onChange, onSubmit, onCancel, placeholder = "Write your reply…", ariaLabel = "Markdown reply", disabled = false, maxLength, autoFocus = false, id, showMeta = true, toolbarPreset = "full", className }: MarkdownEditorProps) {
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const onCancelRef = useRef(onCancel);
  const externalUpdate = useRef(false);
  const [linkEditor, setLinkEditor] = useState<{ editor: Editor; value: string; error: string | null } | null>(null);
  const editorId = useId();
  const helpId = `${id ?? `markdown-editor-${editorId.replaceAll(":", "")}`}-help`;
  // The editor's handlers are bound once; they read the latest callbacks, updated after each render.
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
    onCancelRef.current = onCancel;
  });

  const extensions = useMemo<AnyExtension[]>(() => [
    // StarterKit 3 bundles Link; it is off there so the one Link below (no open on click) is not registered twice (tiptap warns).
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
    Link.configure({ openOnClick: false }),
    Placeholder.configure({ placeholder }),
    Markdown,
  ], [placeholder]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions,
    content: value,
    contentType: "markdown",
    onUpdate: ({ editor: next }) => {
      if (externalUpdate.current) return;
      const markdown = markdownOf(next);
      if (maxLength !== undefined && markdown.length > maxLength) {
        next.commands.undo();
        return;
      }
      onChangeRef.current(markdown);
    },
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-describedby": helpId,
        "aria-keyshortcuts": [onSubmit ? "Meta+Enter" : null, onSubmit ? "Control+Enter" : null, onCancel ? "Escape" : null].filter(Boolean).join(" "),
        "aria-multiline": "true",
        ...(id ? { id } : {}),
        class: "markdown-editor-content min-h-28 px-3 py-2 text-sm leading-6 outline-none",
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && onSubmitRef.current) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        if (event.key === "Escape" && onCancelRef.current) {
          event.preventDefault();
          onCancelRef.current();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = markdownOf(editor);
    if (current === value) return;
    externalUpdate.current = true;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
    externalUpdate.current = false;
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (autoFocus) editor?.commands.focus("end");
  }, [autoFocus, editor]);

  const openLinkEditor = () => {
    if (!editor) return;
    setLinkEditor({ editor, value: editor.getAttributes("link").href ?? "", error: null });
  };
  const changeLink = (next: string) => setLinkEditor((current) => current ? { ...current, value: next, error: null } : current);
  const applyLink = () => {
    if (!linkEditor) return;
    const href = linkEditor.value.trim();
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
      setLinkEditor((current) => current ? { ...current, error: "Enter a valid http, mailto or tel URL." } : current);
      return;
    }
    linkEditor.editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkEditor(null);
  };
  const removeLink = () => {
    linkEditor?.editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkEditor(null);
  };

  return (
    <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background", disabled && "opacity-60", className)} data-editor="tiptap-markdown" data-testid="markdown-editor">
      <span className="sr-only" id={helpId}>
        Markdown editor. {onSubmit ? "Meta or Control plus Enter saves." : "Saving is controlled by the surrounding actions."} {onCancel ? "Escape cancels editing." : ""}
      </span>
      <EditorToolbar disabled={disabled} editor={editor} linkError={linkEditor?.error ?? null} linkOpen={linkEditor !== null} linkValue={linkEditor?.value ?? ""} onLinkApply={applyLink} onLinkChange={changeLink} onLinkClose={() => setLinkEditor(null)} onLinkOpen={openLinkEditor} onLinkRemove={removeLink} preset={toolbarPreset} />
      <EditorContent editor={editor} />
      {showMeta && <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-1.5 text-muted-foreground text-xs">
        <span>Markdown is saved as written. Nothing is sent from this editor.</span>
        <span>{value.length}{maxLength ? `/${maxLength}` : ""}{onSubmit ? " · Meta/Ctrl + Enter saves" : ""}{onCancel ? " · Esc cancels" : ""}</span>
      </div>}
    </div>
  );
}
