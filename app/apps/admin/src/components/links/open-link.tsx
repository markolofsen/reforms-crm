"use client";

import type { ReactNode } from "react";
import { destinationOf, NO_APPS, openLinkOf, type Destination, type OpenLink } from "@hub/contract/local";
import { Link } from "@hub/ui/link";
import { MenuLinkItem } from "@hub/ui/menu";
import { ActionButton, type ActionButtonProps, type ActionSize, type ActionVariant } from "@hub/ui/product/action-button";
import { anchorProps } from "@/lib/external";
import { useInstance } from "@/lib/status";

// P131 O3: the one way the admin opens a Notion page, a Telegram chat or a WhatsApp chat. The server knows which apps this
// Mac has (`apps` on the instance, its probe); the browser never guesses with timers. The app's link in the same tab when
// the app is here, else the web page in a new tab, and the label says which. Nothing is prefilled: an open only opens.

/** A destination of the registry's table, or any URL it recognises (a Quick Link, a stored Notion URL). */
export type OpenTo = Destination | string | null | undefined;

/** How `to` opens on this Mac, or null when it cannot (no destination, or a Telegram phone without the app). */
export function useOpenLink(to: OpenTo): OpenLink | null {
  const instance = useInstance();
  const d = typeof to === "string" ? destinationOf(to) : (to ?? null);
  return openLinkOf(d, instance.data?.apps ?? NO_APPS, instance.data?.localOpen === true);
}

type Look = { size?: ActionSize; variant?: ActionVariant; className?: string; tooltip?: ActionButtonProps["tooltip"]; children?: (link: OpenLink) => ReactNode; ariaLabel?: (link: OpenLink) => string };

/** An Open button as a real anchor (keyboard, middle click); nothing when `to` cannot be opened here. */
export function OpenLinkButton({ to, size = "s", variant = "quiet", className, tooltip, children, ariaLabel }: Look & { to: OpenTo }) {
  const link = useOpenLink(to);
  if (!link) return null;
  return (
    <ActionButton aria-label={ariaLabel?.(link)} className={className} render={<Link bare {...anchorProps(link)} />} size={size} tooltip={tooltip ?? link.label} variant={variant}>
      {children ? children(link) : link.label}
    </ActionButton>
  );
}

/** The menu form; `web: true` is the secondary "Open in browser" item, shown only when the primary opens the app. */
export function OpenLinkItem({ to, children, web = false }: { to: OpenTo; children?: (link: OpenLink) => ReactNode; web?: boolean }) {
  const link = useOpenLink(to);
  const d = typeof to === "string" ? destinationOf(to) : (to ?? null);
  if (!link) return null;
  if (web && (!link.inApp || !d?.web)) return null;
  const shown: OpenLink = web && d?.web ? { href: d.web, newTab: true, inApp: false, label: "Open in browser" } : link;
  return <MenuLinkItem {...anchorProps(shown)}>{children ? children(shown) : shown.label}</MenuLinkItem>;
}
