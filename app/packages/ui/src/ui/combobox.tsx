"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../cn";

export const Combobox: typeof ComboboxPrimitive.Root = ComboboxPrimitive.Root;

export function ComboboxLabel({ className, ...props }: ComboboxPrimitive.Label.Props): React.ReactElement {
  return <ComboboxPrimitive.Label className={cn("font-medium text-sm", className)} data-slot="combobox-label" {...props} />;
}

export function ComboboxInputGroup({ className, ...props }: ComboboxPrimitive.InputGroup.Props): React.ReactElement {
  return <ComboboxPrimitive.InputGroup className={cn("relative flex min-h-11 items-center rounded-lg border border-input bg-background shadow-xs/5 transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 lg:min-h-9", className)} data-slot="combobox-input-group" {...props} />;
}

export function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props): React.ReactElement {
  return <ComboboxPrimitive.Input className={cn("min-w-0 flex-1 bg-transparent px-3 py-1.5 text-base outline-none placeholder:text-muted-foreground sm:text-sm", className)} data-slot="combobox-input" {...props} />;
}

export function ComboboxTrigger({ className, ...props }: ComboboxPrimitive.Trigger.Props): React.ReactElement {
  return <ComboboxPrimitive.Trigger className={cn("inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md p-1.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 lg:min-h-8 lg:min-w-8", className)} data-slot="combobox-trigger" {...props} />;
}

export function ComboboxPortal(props: ComboboxPrimitive.Portal.Props): React.ReactElement {
  return <ComboboxPrimitive.Portal {...props} />;
}

export function ComboboxPopup({ children, className, sideOffset = 4, align = "start", side = "bottom", ...props }: ComboboxPrimitive.Popup.Props & { sideOffset?: ComboboxPrimitive.Positioner.Props["sideOffset"]; align?: ComboboxPrimitive.Positioner.Props["align"]; side?: ComboboxPrimitive.Positioner.Props["side"] }): React.ReactElement {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner align={align} className="z-50 outline-none" data-slot="combobox-positioner" side={side} sideOffset={sideOffset}>
        <ComboboxPrimitive.Popup className={cn("relative w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) rounded-lg border bg-popover text-popover-foreground shadow-lg/5 outline-none transition-[scale,opacity] data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0", className)} data-slot="combobox-popup" {...props}>
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

export function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props): React.ReactElement {
  return <ComboboxPrimitive.List className={cn("max-h-[min(22.5rem,var(--available-height))] overflow-y-auto overscroll-contain py-1 scroll-py-1 outline-none", className)} data-slot="combobox-list" {...props} />;
}

export function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props): React.ReactElement {
  return <ComboboxPrimitive.Empty className={cn("px-3 py-2 text-muted-foreground text-sm", className)} data-slot="combobox-empty" {...props} />;
}

export function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props): React.ReactElement {
  return (
    <ComboboxPrimitive.Item className={cn("grid min-h-11 cursor-default select-none grid-cols-[1rem_1fr_auto] items-center gap-2 rounded-sm px-2 py-1 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-64 data-highlighted:bg-accent data-highlighted:text-accent-foreground lg:min-h-8", className)} data-slot="combobox-item" {...props}>
      <ComboboxPrimitive.ItemIndicator className="col-start-1 inline-flex items-center justify-center">
        <CheckIcon aria-hidden="true" className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
      {children}
    </ComboboxPrimitive.Item>
  );
}

export { ChevronDownIcon };
