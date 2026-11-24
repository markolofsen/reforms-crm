// The GET half of a lead form check (P46). Read only: GET requests to the page, its own scripts and the endpoint. Never a POST.
import type { CheckResult } from "../types";
import type { LeadForm } from "./config";
import { cspRefuses } from "./csp";
import { errText, request, type Answer } from "./net";

export { errText } from "./net";
/** A page with more same-origin scripts than this is read up to here; the endpoint is usually referenced by the first chunks. */
const MAX_SCRIPTS = 60;
export const TURNSTILE_HOST = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const UA = "hub-doctor-leads/1 (read-only check; https://github.com/markolofsen/reforms-hub)";

export interface Probe { ok: boolean; notes: string[]; problem?: string; level?: CheckResult["level"] }

const fieldPresent = (html: string, name: string) => new RegExp(`name\\s*=\\s*["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(html);
const metaCsp = (html: string): string | null => /<meta[^>]+http-equiv\s*=\s*["']content-security-policy["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] ?? null;
const scriptSrcs = (html: string): string[] => [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!);

/** What the page must mention for its form to post to the endpoint: the path when same-origin, else the host. */
export const referenceOf = (page: URL, endpoint: URL): string => (endpoint.origin === page.origin ? endpoint.pathname.replace(/\/$/, "") : endpoint.host);

type Get = (url: string, init?: RequestInit, o?: { body?: boolean }) => Promise<Answer>;

/** Does the HTML, or one of the page's own scripts, contain `needle`? `unread`: scripts that could not be fetched (a reason, not a verdict). */
async function referenced(get: Get, html: string, base: URL, needle: string): Promise<{ found: boolean; unread: string[] }> {
  if (html.includes(needle)) return { found: true, unread: [] };
  const own = [...new Set(scriptSrcs(html))].map((s) => { try { return new URL(s, base); } catch { return undefined; } })
    .filter((u): u is URL => !!u && u.origin === base.origin).slice(0, MAX_SCRIPTS);
  const unread: string[] = [];
  const hits = await Promise.all(own.map(async (u) => {
    try { const r = await get(u.href); return r.status >= 200 && r.status < 300 && r.text.includes(needle); } catch (e) { unread.push(`${u.pathname}: ${errText(e)}`); return false; }
  }));
  return { found: hits.some(Boolean), unread };
}

/**
 * Page answers 200; the served form carries its fields (static forms); the page or its scripts reference the endpoint; the page's CSP lets a
 * script reach the endpoint; Turnstile, when configured, is on the page and allowed by the CSP; the endpoint answers a GET with anything but
 * a missing route or a server error (a POST-only handler says 405, a signed-in one 401).
 */
export async function probeForm(fetchFn: typeof fetch, form: LeadForm, deadline: AbortSignal): Promise<Probe> {
  const get: Get = (url, init = {}, o) => request(fetchFn, url, { ...init, headers: { "user-agent": UA, ...(init.headers ?? {}) } }, deadline, o);
  const notes: string[] = [];
  const no = (problem: string, level: CheckResult["level"] = "fail"): Probe => ({ ok: false, notes, problem, level });

  let page: Answer;
  try { page = await get(form.page); } catch (e) { return no(`page ${form.page} unreachable: ${errText(e)}`); }
  if (page.status !== 200) return no(`page ${form.page} answered ${page.status}`);
  const finalUrl = new URL(page.url || form.page);
  if (page.redirected && finalUrl.href !== form.page) notes.push(`page redirects to ${finalUrl.pathname}`);
  const html = page.text;
  const csp = [page.headers.get("content-security-policy"), metaCsp(html)].filter(Boolean).join(", ") || null;

  if (form.render === "static") {
    const missing = form.fields.filter((f) => !fieldPresent(html, f));
    if (missing.length) return no(`page has no field ${missing.join(", ")} (form changed or not served)`);
    notes.push(`${form.fields.length} fields`);
  } else notes.push("client-rendered form (fields not in HTML)");

  const endpoint = new URL(form.endpoint);
  const needle = referenceOf(finalUrl, endpoint);
  const ref = await referenced(get, html, finalUrl, needle);
  if (!ref.found && ref.unread.length) return no(`the endpoint ${needle} is not in the page, and ${ref.unread.length} of its scripts could not be read: ${ref.unread.slice(0, 2).join("; ")}`);
  if (!ref.found) return no(`neither the page nor its scripts reference ${needle}: the form does not post to the endpoint`);
  notes.push(`references ${needle}`);

  const refused = cspRefuses(csp, "connect-src", endpoint, finalUrl);
  if (refused) return no(`CSP ${refused} does not allow ${endpoint.origin}`);
  notes.push(csp ? "CSP allows endpoint" : "no CSP");

  if (form.turnstile !== false) {
    if (!/cf-turnstile|challenges\.cloudflare\.com\/turnstile/.test(html)) return no("Turnstile is configured but the page has no widget");
    if (typeof form.turnstile === "object" && !html.includes(form.turnstile.sitekey)) return no("Turnstile widget carries another sitekey");
    const ts = new URL(TURNSTILE_HOST);
    const bad = cspRefuses(csp, "script-src", ts, finalUrl) ?? cspRefuses(csp, "frame-src", ts, finalUrl);
    if (bad) return no(`CSP ${bad} does not allow ${ts.origin} (Turnstile)`);
    notes.push("Turnstile widget");
  }

  let ep: Answer;
  try { ep = await get(form.endpoint, { redirect: "manual" }, { body: false }); } catch (e) { return no(`endpoint ${form.endpoint} unreachable: ${errText(e)}`); }
  if (ep.status === 404 || ep.status >= 500) return no(`endpoint GET ${ep.status}: the route is missing or failing`);
  if (ep.status >= 300 && ep.status < 400) return no(`endpoint GET ${ep.status} to ${ep.headers.get("location") ?? "?"}: a redirect may drop the POST`, "warn");
  notes.push(`endpoint GET ${ep.status}${ep.attempts > 1 ? " (on the retry)" : ""}`);
  return { ok: true, notes };
}
