// The one module that opens addresses outside the app (`mailto:`, the terminal's web links), and the other place that may touch `location`.

const recipients = (list: string): string => list.split(/[,;]/).map((a) => a.trim()).filter((a) => a !== "").map(encodeURIComponent).join(",");

/**
 * A compose window addressed and titled. Nothing is sent; the person presses Send in Mail. Recipients are separated by a
 * literal comma (RFC 6068), each address encoded on its own; the subject is encoded so `&`, `+` and spaces survive.
 */
export function composeHref(d: { toAddr: string; ccAddr: string | null; subject: string }): string {
  const cc = d.ccAddr ? recipients(d.ccAddr) : "";
  return `mailto:${recipients(d.toAddr)}?subject=${encodeURIComponent(d.subject)}${cc ? `&cc=${cc}` : ""}`;
}

/** Hands an external address (`mailto:`) to the system. */
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
