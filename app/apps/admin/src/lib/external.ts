// The one module that hands addresses outside the app to the browser, and the other place that may touch `location` (P131
// verdict 5: no `notion.so`, `t.me`, `wa.me`, `tg:`, `notion:` or `whatsapp:` literal and no `target="_blank"` anywhere else in
// the admin; `test/rules.test.ts`). The links themselves come from the registry's destinations table (`@hub/contract/local`):
// `openLinkOf` decides app or web from this Mac's apps (`components/links/open-link.tsx` is its hook and its component).
import type { OpenLink } from "@hub/contract/local";

/** A link the app hands to the system in the same tab (`mailto:`, `message:`, an app's own scheme). */
export const sameTab = (href: string): OpenLink => ({ href, newTab: false, inApp: true, label: "" });

/**
 * A web page a terminal printed: any http(s) host, opened in a new tab. A terminal prints whatever a program writes, so
 * `javascript:`, `file:` and the rest are refused (null); a fixed table cannot list its hosts, so it stays outside the registry.
 */
export function webLink(uri: string): OpenLink | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return { href: url.href, newTab: true, inApp: false, label: "Open in browser" };
}

/** An anchor's attributes for a link: a web page opens in a new tab with `noopener` (the page cannot reach this one). */
export function anchorProps(link: OpenLink): { href: string; target?: "_blank"; rel?: string } {
  return link.newTab ? { href: link.href, target: "_blank", rel: "noopener noreferrer" } : { href: link.href };
}

/** Opens a link from code rather than an anchor (Reply in Mail's compose window, a terminal's link). False when there is none. */
export function openLink(link: OpenLink | null): boolean {
  if (!link) return false;
  if (link.newTab) window.open(link.href, "_blank", "noopener,noreferrer");
  else window.location.href = link.href;
  return true;
}

/** Puts text on the clipboard. False when the browser refused: each caller says what that means in its own words. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
