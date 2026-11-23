"use client";

import { useMutation } from "@tanstack/react-query";
import { MonitorIcon } from "lucide-react";
import type { ReactNode } from "react";
import { desktopHandoffReason, isServerAction, linkOf, LOCAL_ACTIONS, type HrefActionId, type LocalActionId, type LocalArgs, type ServerActionId } from "@hub/contract/local";
import { Link } from "@hub/ui/link";
import { MenuItem, MenuLinkItem } from "@hub/ui/menu";
import { ActionButton, type ActionButtonProps, type ActionSize, type ActionVariant } from "@hub/ui/product/action-button";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { metaApi } from "@/lib/api/meta";
import { openExternal } from "@/lib/external";
import { useInstance } from "@/lib/status";

// P61: the one way the admin opens something on the owner's Mac. `href` actions (Mail, Notion) are real links built by the
// registry (`@hub/contract/local`); `server` actions (Finder, a project file) post a project and a KEY to
// `POST /api/local/:action` and the server resolves the path. An Open changes nothing in the Hub and asks no agent anything
// (`admin-principles.md` rule 1). Not in `@hub/ui`: it knows the API.

type Io = { post: (action: ServerActionId, args: unknown) => Promise<unknown>; open: (href: string) => void; say: (text: string) => void };

/** Runs one action: an href is handed to the system, a server action posted once; a refusal is said in words. True when it went out. */
export async function runLocalAction(action: LocalActionId, args: unknown, io: Io): Promise<boolean> {
  if (!isServerAction(action)) {
    const href = linkOf(action, args);
    if (!href) {
      io.say("No link can be built for this.");
      return false;
    }
    io.open(href);
    return true;
  }
  try {
    await io.post(action, args);
    return true;
  } catch (e) {
    io.say(sentence(e));
    return false;
  }
}

const sayRefusal = (text: string) => toastManager.add({ title: "Not opened", description: text, type: "error" });

/** `run(args)`, whether it is running, and whether this machine can run server actions (`localOpen` of the instance). */
export function useLocalAction(action: LocalActionId) {
  const instance = useInstance();
  const m = useMutation({ mutationFn: (args: unknown) => runLocalAction(action, args, { post: metaApi.localOpen, open: openExternal, say: sayRefusal }) });
  return { run: (args: unknown) => m.mutate(args), pending: m.isPending, available: !isServerAction(action) || instance.data?.localOpen === true };
}

/** `ariaLabel` only for an icon-only button: otherwise the content names it, so the name holds its visible text (WCAG 2.5.3). */
type Look = { size?: ActionSize; variant?: ActionVariant; children?: ReactNode; className?: string; tooltip?: ActionButtonProps["tooltip"]; ariaLabel?: string };
type Untyped<A> = Look & { action: A; args: unknown };

/** An `href` action as a real anchor: keyboard, middle click and the server being down all work. Null when no link can be built. */
function HrefButton({ action, args, size = "s", variant = "quiet", children, className, tooltip, ariaLabel }: Untyped<HrefActionId>) {
  const href = linkOf(action, args);
  if (!href) return null;
  return (
    <ActionButton aria-label={ariaLabel} className={className} render={<Link bare href={href} />} size={size} tooltip={tooltip ?? LOCAL_ACTIONS[action].label} variant={variant}>
      {children ?? LOCAL_ACTIONS[action].label}
    </ActionButton>
  );
}

function ServerButton({ action, args, size = "s", variant = "quiet", children, className, tooltip, ariaLabel }: Untyped<ServerActionId>) {
  const a = useLocalAction(action);
  if (!a.available) return null;
  return (
    <ActionButton aria-label={ariaLabel} className={className} disabled={a.pending} onClick={() => a.run(args)} size={size} tooltip={tooltip ?? LOCAL_ACTIONS[action].label} variant={variant}>
      {children ?? LOCAL_ACTIONS[action].label}
    </ActionButton>
  );
}

/** One Open button. A `server` action renders nothing when the machine cannot open (not macOS); an `href` one nothing when it has no link. */
export function LocalActionButton<A extends LocalActionId>(p: Look & { action: A; args: LocalArgs<A> }) {
  const { action, ...rest } = p;
  return isServerAction(action) ? <ServerButton action={action} {...rest} /> : <HrefButton action={action} {...rest} />;
}

function ServerItem({ action, args, children }: { action: ServerActionId; args: unknown; children?: ReactNode }) {
  const a = useLocalAction(action);
  if (!a.available) return null;
  return (
    <MenuItem disabled={a.pending} onClick={() => a.run(args)}>
      {children ?? LOCAL_ACTIONS[action].label}
    </MenuItem>
  );
}

/** The menu form: a `MenuLinkItem` for an `href` action, a `MenuItem` that posts for a `server` one; the same rules for rendering nothing. */
export function LocalActionItem<A extends LocalActionId>({ action, args, children, newTab = false }: { action: A; args: LocalArgs<A>; children?: ReactNode; /** A web page (Notion on the web) opens in a new tab. */ newTab?: boolean }) {
  if (isServerAction(action)) return <ServerItem action={action} args={args}>{children}</ServerItem>;
  const href = linkOf(action, args);
  if (!href) return null;
  return (
    <MenuLinkItem href={href} {...(newTab ? { rel: "noopener noreferrer", target: "_blank" } : {})}>
      {children ?? LOCAL_ACTIONS[action].label}
    </MenuLinkItem>
  );
}

/**
 * The dock's "Open in Claude Desktop" (P61 section 9, slice L5): declared, not offered (owner item 7). Disabled with its reason
 * for an agent tab; nothing for a Shell tab or when this machine cannot open. A disabled button is not a tab stop.
 */
export function DesktopHandoffButton({ preset }: { preset: string }) {
  const instance = useInstance();
  const reason = desktopHandoffReason(preset);
  if (!reason || instance.data?.localOpen !== true) return null;
  return (
    <ActionButton aria-label={`${LOCAL_ACTIONS["agent.openInDesktop"].label}: ${reason}`} disabled icon size="s" tooltip={reason} variant="quiet">
      <MonitorIcon aria-hidden="true" />
    </ActionButton>
  );
}
