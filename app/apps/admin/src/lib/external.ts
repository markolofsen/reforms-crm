// The one module that hands addresses outside the app to the browser, and the other place that may touch `location`. The
// links themselves are built by the registry (`@hub/contract/local`, P61); `openWebLink` stays outside it on purpose: a
// terminal prints arbitrary hosts, which a fixed table cannot list, and it opens a browser tab, not an OS program.

/** Hands an `href` action of the registry (a `mailto:` compose window) to the system, for an open made from code rather than an anchor. */
export function openExternal(href: string): void {
  window.location.href = href;
}

/**
 * Opens a web link from the terminal in a new tab with `noopener` (the page it opens cannot reach this one). Only http and
 * https: a terminal prints whatever a program writes, so `javascript:`, `file:` and the rest are refused. False when refused.
 */
export function openWebLink(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  window.open(url.href, "_blank", "noopener,noreferrer");
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
