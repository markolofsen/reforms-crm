import type { BookingProbe } from "@hub/projects/doctor";

// P155 verdict 11: one GET of a project's booking link for `hub doctor <project>`. Only a host that does not resolve and a page
// that is gone (404, 410) are warnings; schedulers often answer scripts with 403 or a challenge, which is "could not check".

const GONE = new Set([404, 410]);
const NO_HOST = new Set(["ENOTFOUND", "EAI_AGAIN", "ENODATA"]);

export async function probeBookingLink(url: string, fetcher: typeof fetch = fetch): Promise<BookingProbe> {
  try {
    const r = await fetcher(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8_000), headers: { accept: "text/html" } });
    await r.body?.cancel().catch(() => undefined);
    if (r.ok) return { state: "ok" };
    if (GONE.has(r.status)) return { state: "not_found", detail: `the page answers ${r.status}: the link is gone, give the current one (hub project setup <slug> --booking or --brand-booking)` };
    return { state: "unknown", detail: `answered ${r.status} (schedulers often refuse scripts)` };
  } catch (e) {
    const code = (e as { cause?: { code?: unknown } }).cause?.code;
    if (typeof code === "string" && NO_HOST.has(code)) return { state: "dns", detail: `the host does not resolve (${code}): check the link` };
    return { state: "unknown", detail: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120) };
  }
}
