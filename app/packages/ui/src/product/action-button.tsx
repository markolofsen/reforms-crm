import { Button, type ButtonProps } from "../ui/button";
import { cn } from "../cn";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The three control heights (tokens `--control-*` in `styles.css`: 32/40/48 at 1024px and up, 44/44/48 below). */
export type ActionSize = "s" | "m" | "l";
/** The four looks of a button. `primary` is the one next step: a card or a bar never shows two. */
export type ActionVariant = "primary" | "secondary" | "quiet" | "danger";

// Full static strings (`stylesheets-and-class-lists.md` rule 1). `sm:` repeats the height so it replaces the coss `sm:h-*`.
export const SIZE_CLASS: Record<ActionSize, string> = {
  s: "h-(--control-s) sm:h-(--control-s) px-3 text-sm",
  m: "h-(--control-m) sm:h-(--control-m) px-4 text-sm",
  l: "h-(--control-l) sm:h-(--control-l) px-5 text-base",
};
const ICON_CLASS: Record<ActionSize, string> = {
  s: "size-(--control-s) sm:size-(--control-s) px-0",
  m: "size-(--control-m) sm:size-(--control-m) px-0",
  l: "size-(--control-l) sm:size-(--control-l) px-0",
};

/** The product vocabulary mapped onto the coss variants, which are never named outside this file. */
export const COSS_VARIANT = { primary: "default", secondary: "outline", quiet: "ghost", danger: "destructive-outline" } as const satisfies Record<ActionVariant, NonNullable<ButtonProps["variant"]>>;

export type ActionButtonProps = Omit<ButtonProps, "size" | "variant"> & {
  size?: ActionSize;
  variant?: ActionVariant;
  /** A square, icon-only button (needs an `aria-label`). */
  icon?: boolean;
  tooltip?: string | { content: string; hotkey?: string; side?: "top" | "right" | "bottom" | "left"; align?: "start" | "center" | "end"; sideOffset?: number };
};

/**
 * The one button of the product: three sizes, four variants (`design-system-and-tokens.md` rule 11). It carries `data-variant`, so a test
 * counts the primaries on screen. coss `Button` is wrapped, not edited.
 */
export function ActionButton({ size = "m", variant = "secondary", icon = false, className, tooltip, ...props }: ActionButtonProps) {
  const button = <Button className={cn(icon ? ICON_CLASS[size] : SIZE_CLASS[size], className)} data-variant={variant} size="default" variant={COSS_VARIANT[variant]} {...props} />;
  if (!tooltip) return button;
  const config = typeof tooltip === "string" ? { content: tooltip } : tooltip;
  // A disabled button takes no focus, so its tooltip (why it is off) hangs on a focusable wrapper that says it is disabled.
  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the wrapper is the tooltip's keyboard trigger: see above
  const trigger = props.disabled || props.loading ? <span aria-disabled="true" className="inline-flex" data-slot="disabled-tooltip-trigger" tabIndex={0}>{button}</span> : button;
  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipPopup align={config.align} side={config.side} sideOffset={config.sideOffset}>
        {config.content}
        {config.hotkey && <kbd className="ms-2 text-muted-foreground">{config.hotkey}</kbd>}
      </TooltipPopup>
    </Tooltip>
  );
}
