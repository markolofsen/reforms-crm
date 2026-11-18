// `config/lead-forms.json`: the instance's public lead forms, one entry per page (P46). Tracked in the instance repository, so it holds
// no secret: a canary secret is named by `secretRef`, a file in `state/secrets/`. Read by the `Leads` doctor group only.
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const ID = /^[a-z0-9][a-z0-9-]*$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
/** Ids of the group's fixed rows (`leads.config`, ...): a form id may not take one. */
const RESERVED = ["config", "registry", "forms"];
const httpUrl = z.string().url().refine((u) => /^https?:\/\//.test(u), "must be an http(s) URL");

const FormSchema = z.object({
  /** Stable id, also the doctor row (`leads.<id>`) and the canary address (`canary+<id>@...`). */
  id: z.string().regex(ID, "lowercase letters, digits and dashes").refine((id) => !RESERVED.includes(id), "config, registry and forms name the group's own rows"),
  /** The registry domain this form belongs to (the cross-check matches on it). */
  domain: z.string().regex(DOMAIN, "a bare host name such as example.com"),
  /** The public page that shows the form. */
  page: httpUrl,
  /** What the browser posts to (the canary posts here too). */
  endpoint: httpUrl,
  /** `static`: the form is in the served HTML, so its fields are checked; `client`: rendered by script, fields are not checked by GET. */
  render: z.enum(["static", "client"]).default("static"),
  /** Field names the served form must carry (`name="..."`); checked when `render` is `static`. */
  fields: z.array(z.string().min(1)).default([]),
  /** The honeypot field: always sent empty by the canary. */
  honeypot: z.string().min(1).optional(),
  /** Turnstile on this form: the page must carry the widget (and this sitekey when given) and its CSP must allow the challenge host. */
  turnstile: z.union([z.literal(false), z.literal(true), z.object({ sitekey: z.string().min(1) })]).default(false),
  canary: z.object({
    /** `signed`: `--canary` sends the signed canary; `none`: the form has no canary path (say why in `notes`). */
    mode: z.enum(["signed", "none"]),
    /** File name in `state/secrets/` that holds the shared HMAC secret. Never the secret itself. */
    secretRef: z.string().regex(ID).optional(),
    /** Fixed fields the handler requires beyond the visitor's (site, form kind, a budget band). */
    body: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  }).refine((c) => c.mode === "none" || !!c.secretRef, "a signed canary needs secretRef"),
  /** Where a submission lands, in words (`django:inquiries`, `notion:leads`, `mail:<setting>`, `telegram`). Documentation for the reader. */
  lands: z.array(z.string().min(1)).default([]),
  /** The receiving-side silence check (L3). `none`: only the canary guards the form. */
  silence: z.object({ source: z.enum(["none", "notion-leads", "mailbox"]), days: z.number().int().positive().nullable() }).default({ source: "none", days: null }),
  notes: z.string().optional(),
}).strict();

const NoneSchema = z.object({ domain: z.string().regex(DOMAIN), reason: z.string().min(3) }).strict();

export const LeadFormsSchema = z.object({
  $comment: z.string().optional(),
  /** The site registry to cross-check, relative to the instance root (or absolute). Every host in its first column needs a form or a `none`. */
  registry: z.string().min(1).optional(),
  /** The canary's address; `{id}` becomes the form id. Our own domain, never a client's. Required by `--canary`. */
  canaryEmail: z.string().regex(/^[^@\s]*\{id\}[^@\s]*@[a-z0-9.-]+\.[a-z]{2,}$/, "an address with {id} in the local part").optional(),
  forms: z.array(FormSchema),
  /** Registry domains that deliberately have no form in this instance, each with the reason. */
  none: z.array(NoneSchema).default([]),
}).strict().superRefine((c, ctx) => {
  const seen = new Set<string>();
  for (const f of c.forms) {
    if (seen.has(f.id)) ctx.addIssue({ code: "custom", message: `duplicate form id ${f.id}` });
    seen.add(f.id);
  }
});

export type LeadForms = z.infer<typeof LeadFormsSchema>;
export type LeadForm = LeadForms["forms"][number];

export type Loaded = { state: "missing" } | { state: "invalid"; error: string } | { state: "ok"; config: LeadForms };

/** Reads and validates the file. Missing is not an error: an instance without public forms lists none. */
export function loadLeadForms(file: string): Loaded {
  if (!existsSync(file)) return { state: "missing" };
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (e) { return { state: "invalid", error: `not JSON: ${e instanceof Error ? e.message : String(e)}` }; }
  const r = LeadFormsSchema.safeParse(raw);
  if (!r.success) return { state: "invalid", error: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  return { state: "ok", config: r.data };
}
