// The signed canary (P46, `hub doctor --only Leads --canary`). One POST to the form's own endpoint, marked so its handler stores a test row
// (`metadata.test`), sends nothing outbound and answers with a dry delivery report. Contract, both sides (core docs `core/22-lead-forms.md`):
//   1. Probe, no write: `OPTIONS <endpoint>` with `X-Canary-Probe: 1`. A handler that knows canaries answers with `X-Canary-Accept: v1`.
//      No such header: the POST is NOT sent (an unaware handler would store a real lead and mail it), the row says so as a WARN.
//   2. `POST <endpoint>`, JSON, `X-Canary: <unix seconds>.<hex HMAC-SHA256(secret, "<unix seconds>")>`, a fresh `Idempotency-Key`.
//      The handler accepts it within 5 minutes of the timestamp, skips Turnstile siteverify and every outbound step.
//   3. Answer: 2xx JSON `{ stored, recipient_ok, route_ok, id? }`, each a boolean.
import { createHmac, randomUUID } from "node:crypto";
import { fileState, readValue } from "@hub/connections";
import type { CheckResult } from "../types";
import type { LeadForm, LeadForms } from "./config";
import { errText, request, type Answer } from "./net";

export const ACCEPT_HEADER = "x-canary-accept";
export const sign = (secret: string, ts: number): string => `${ts}.${createHmac("sha256", secret).update(String(ts)).digest("hex")}`;

/** The canary's values: the configured fixed fields, then each listed field filled with something that is plainly not a person. */
export function canaryBody(form: LeadForm, email: string, ts: number): Record<string, string | number | boolean> {
  const body: Record<string, string | number | boolean> = {};
  for (const f of form.fields) {
    body[f] = /e-?mail/i.test(f) ? email : /^name$|full.?name/i.test(f) ? "Hub canary" : /message|comment|details/i.test(f) ? `Hub lead-form canary ${ts}, form ${form.id}: a test, not a lead.` : /phone/i.test(f) ? "" : "canary";
  }
  Object.assign(body, form.canary.body);
  if (form.honeypot) body[form.honeypot] = "";
  return body;
}

export interface CanaryOut { level: CheckResult["level"]; detail: string }

/**
 * Each request has its own timeout and one retry on a network failure (`net.ts`). The POST is retried with the SAME Idempotency-Key and
 * signature, so a handler that stored the first attempt answers the second from its idempotency record; at worst a second test row, which
 * the site's purge removes like the first.
 */
export async function sendCanary(fetchFn: typeof fetch, cfg: LeadForms, form: LeadForm, secretsDir: string, deadline: AbortSignal, now = Date.now()): Promise<CanaryOut> {
  if (form.canary.mode === "none") return { level: "warn", detail: `canary: none for this form${form.notes ? ` (${form.notes})` : ""}` };
  const ref = form.canary.secretRef!;
  const st = fileState(secretsDir, ref);
  if (st.state !== "stored") return { level: "warn", detail: `canary not run: state/secrets/${ref} is ${st.state === "unsafe-mode" ? `mode ${st.mode}, must be 600` : st.state}` };
  if (!cfg.canaryEmail) return { level: "warn", detail: "canary not run: canaryEmail is not set in config/lead-forms.json" };
  const secret = readValue(secretsDir, ref) ?? "";

  let probe: Answer;
  try { probe = await request(fetchFn, form.endpoint, { method: "OPTIONS", headers: { "x-canary-probe": "1" }, redirect: "manual" }, deadline, { body: false }); } catch (e) { return { level: "fail", detail: `canary probe failed: ${errText(e)}` }; }
  if (!(probe.headers.get(ACCEPT_HEADER) ?? "").split(/[\s,]+/).includes("v1")) return { level: "warn", detail: "canary not supported by endpoint (no X-Canary-Accept: v1 on OPTIONS; nothing was posted)" };

  const ts = Math.floor(now / 1000);
  const email = cfg.canaryEmail.replace("{id}", form.id);
  let r: Answer;
  try {
    r = await request(fetchFn, form.endpoint, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/json", "x-canary": sign(secret, ts), "idempotency-key": randomUUID() },
      body: JSON.stringify(canaryBody(form, email, ts)),
    }, deadline);
  } catch (e) { return { level: "fail", detail: `canary POST failed: ${errText(e)}` }; }
  const text = r.text;
  if (r.status < 200 || r.status >= 300) return { level: "fail", detail: `canary POST ${r.status}: ${text.slice(0, 160).replace(/\s+/g, " ")}` };
  let j: Record<string, unknown>;
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { return { level: "fail", detail: `canary POST ${r.status} but the answer is not JSON` }; }
  const keys = ["stored", "recipient_ok", "route_ok"] as const;
  const absent = keys.filter((k) => typeof j[k] !== "boolean");
  if (absent.length) return { level: "fail", detail: `canary answer lacks ${absent.join(", ")} (handler advertises v1 but does not report)` };
  const bad = keys.filter((k) => j[k] !== true);
  const id = typeof j.id === "string" || typeof j.id === "number" ? ` row ${j.id}` : "";
  if (bad.length) return { level: "fail", detail: `canary${id}: ${bad.map((k) => `${k}=false`).join(", ")} (${CAUSE[bad[0]!]})` };
  return { level: "pass", detail: `canary${id}: stored, recipient ok, route ok` };
}

const CAUSE: Record<"stored" | "recipient_ok" | "route_ok", string> = {
  stored: "the handler did not store the row",
  recipient_ok: "no notification recipient resolves: a real lead would reach nobody",
  route_ok: "the CRM or Notion destination is not configured or not reachable",
};
