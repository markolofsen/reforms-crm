// The one module that opens addresses outside the app (`mailto:`), and the other place that may touch `location`.

/** A compose window addressed and titled. Nothing is sent; the person presses Send in Mail. */
export function composeHref(d: { toAddr: string; ccAddr: string | null; subject: string }): string {
  const q = new URLSearchParams({ subject: d.subject });
  if (d.ccAddr) q.set("cc", d.ccAddr);
  return `mailto:${encodeURIComponent(d.toAddr)}?${q.toString().replaceAll("+", "%20")}`;
}

/** Hands an external address (`mailto:`) to the system. */
export function openExternal(href: string): void {
  window.location.href = href;
}
