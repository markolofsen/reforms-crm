"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { Link } from "@hub/ui/link";
import { usePlace } from "@/hooks/use-project";
import { formatDest, type Dest } from "@/routes/paths";
import { routeOf } from "@/routes/typed";

type Props = Omit<React.ComponentProps<typeof Link>, "href"> & { to: Dest; /** Another project than the open one (an Overview row leads into its own). */ inProject?: string | null };

/** A plain left click that the browser would handle in this tab: not a modified click, not another target, not already handled. */
const inPlace = (e: React.MouseEvent<HTMLAnchorElement>, target: string | undefined): boolean =>
  !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (target === undefined || target === "_self");

/**
 * The one internal link: a real `<a href="/mail/42">` (`/lisbon/mail/42` with several projects), so open-in-new-tab, copy-link and modifier clicks work,
 * and a plain click moves through the framework router (no reload, the shell stays mounted). `to` is a destination from
 * `paths.*`, never a string, so a typo fails `tsc`; the framework's own `href` takes any `UrlObject`, which is why this is
 * the only module that builds an address for a link (P32 N0 q1). The place (project and whether there are several) is applied here.
 */
export function AppLink({ to, inProject, onClick, ...props }: Props): React.ReactElement {
  const router = useRouter();
  const place = usePlace();
  const href = formatDest(to, inProject === undefined || inProject === null ? place : { ...place, project: inProject });
  return (
    <Link
      {...props}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (!inPlace(e, props.target)) return;
        const next = routeOf(href);
        if (!next) return;
        e.preventDefault();
        router.push(next);
      }}
    />
  );
}
