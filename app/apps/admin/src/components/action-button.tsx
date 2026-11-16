import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The three control heights (tokens `--control-*` in `index.css`: 32/40/48 at 1024px and up, 44/44/48 below). */
export type ActionSize = "s" | "m" | "l";
/** The four looks of a button. `primary` is the one next step: a card or a bar never shows two. */
export type ActionVariant = "primary" | "secondary" | "quiet" | "danger";

// Full static strings (rules: stylesheets-and-class-lists 1). `sm:` repeats the height so it replaces the coss `sm:h-*`.
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
};

/**
 * The one button of the product: three sizes, four variants (design-system rule 11). It carries `data-variant`, so a test
 * counts the primaries on screen. coss `Button` is wrapped, not edited.
 */
export function ActionButton({ size = "m", variant = "secondary", icon = false, className, ...props }: ActionButtonProps) {
  return <Button className={cn(icon ? ICON_CLASS[size] : SIZE_CLASS[size], className)} data-variant={variant} size="default" variant={COSS_VARIANT[variant]} {...props} />;
}
