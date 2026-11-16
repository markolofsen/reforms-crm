// The kind registry: data owned by core. A kind says which modules a project uses, which settings it must have once
// it is no longer a draft, its mail classes, Notion modules, allowed skills and a starting knowledge taxonomy.
// Kinds are neutral by rule (`@docs/LAYERS.md`): no owner, product or region names. Add a kind only when a second
// project needs it. Everything is validated against the `Kind` schema when this module loads.
import { Kind, type ProjectConfig } from "./schema.js";

const MAIL_CLASSES = [
  { id: "client", color: "Green", neverSpam: true },
  { id: "partner", color: "Blue", neverSpam: true },
  { id: "security", color: "Dark red", neverSpam: true },
  { id: "calendar", color: "Dark purple" },
  { id: "service", color: "Light cyan", skippable: true, triage: "count-only" },
  { id: "marketing", color: "Muted yellow", skippable: true, triage: "count-only" },
  { id: "cold-outreach", color: "Light gray", triage: "count-only" },
  { id: "spam", color: "Dark gray", triage: "count-only" },
];
const SKILLS = ["triage-mail", "bulk-drafts", "calendar", "knowledge-import", "kb-review", "mail-filters", "notion-project-deploy", "project-setup", "status", "owner-inbox", "review-sent"];
// Client-facing classes only: a reply to security, calendar, marketing, spam or cold outreach is never autosent.
const SEND = (...extra: string[]) => ({ classes: ["client", "partner", ...extra], dailyCap: 5, delayMinutes: 10 });
const REQUIRED = ["mail.accounts", "mail.sender", "tone"];

const RAW = [
  {
    id: "generic",
    title: "Generic project",
    description: "Mail, a Notion CRM with clients and reports, and a knowledge base. The set every project had before kinds existed.",
    modules: ["mail", "calendar", "knowledge", "filters", "notion", "bulk"],
    required: [...REQUIRED, "notion.databases.clients", "notion.databases.reports"],
    notionModules: ["sales", "reports"],
    mailClasses: MAIL_CLASSES,
    send: SEND(),
    skills: SKILLS,
    defaults: { languages: ["en"] },
    taxonomy: { audiences: ["CLIENT", "LEAD", "ANY"], category: [], stages: [] },
  },
  {
    id: "sales-pipeline",
    title: "Real-estate CRM",
    description: "A sales pipeline: clients, leads and reports in Notion, calendar holds for viewings, bulk follow-ups.",
    modules: ["mail", "calendar", "knowledge", "filters", "notion", "bulk"],
    required: [...REQUIRED, "notion.databases.clients", "notion.databases.leads", "notion.databases.reports"],
    notionModules: ["sales", "leads", "tasks", "reports", "workflows"],
    mailClasses: MAIL_CLASSES,
    send: SEND(),
    skills: SKILLS,
    defaults: { languages: ["en"], toneHint: "warm, plain, personal" },
    taxonomy: {
      audiences: ["CLIENT", "LEAD", "SELLER", "LAWYER", "BANK", "ANY"],
      category: ["PLAYBOOK", "PROGRAMMES", "DEVELOPMENTS", "BUYING", "TAX"],
      stages: ["DISCOVERY", "CHOOSING", "ENQUIRY", "RESERVING", "OWNING"],
    },
  },
  {
    id: "software-support",
    title: "SaaS support",
    description: "Customer support for a software product: clients and reports in Notion, billing and bug mail, no calendar.",
    modules: ["mail", "knowledge", "filters", "notion"],
    required: [...REQUIRED, "notion.databases.clients", "notion.databases.reports"],
    notionModules: ["sales", "leads", "reports", "workflows", "documents", "business-contacts", "tasks"],
    mailClasses: [...MAIL_CLASSES, { id: "customer-bug", color: "Orange", neverSpam: true }, { id: "billing", color: "Light green", neverSpam: true }],
    send: SEND("customer-bug", "billing"),
    skills: SKILLS.filter((s) => s !== "calendar" && s !== "bulk-drafts"),
    defaults: { languages: ["en"], toneHint: "neutral, precise" },
    taxonomy: {
      audiences: ["CLIENT", "LEAD", "ANY"],
      category: ["PRICING", "API", "BILLING", "DATA", "TERMS", "SUPPORT"],
      stages: ["SCOPING", "QUOTED", "NEGOTIATING", "ACTIVE"],
    },
  },
  {
    id: "shop",
    title: "Shop",
    description: "Orders and returns by mail with a knowledge base; no Notion CRM.",
    modules: ["mail", "knowledge", "filters"],
    required: REQUIRED,
    notionModules: [],
    mailClasses: [...MAIL_CLASSES, { id: "order", color: "Light green", neverSpam: true }, { id: "shipping", color: "Light blue", neverSpam: true }, { id: "return", color: "Orange", neverSpam: true }],
    send: SEND("order", "shipping", "return"),
    skills: SKILLS.filter((s) => s !== "bulk-drafts" && s !== "calendar" && s !== "notion-project-deploy"),
    defaults: { languages: ["en"], toneHint: "short, friendly" },
    taxonomy: { audiences: ["CLIENT", "ANY"], category: [], stages: [] },
  },
];

export const KINDS: Readonly<Record<string, Kind>> = Object.freeze(Object.fromEntries(RAW.map((r) => Kind.parse(r)).map((k) => [k.id, k])));
export const DEFAULT_KIND = "generic";
export const KIND_IDS: readonly string[] = Object.keys(KINDS);

export const kindOf = (id: string): Kind | undefined => KINDS[id];

/** Whether the dotted `path` has a value in a resolved config. `notion.databases.<slug>` asks for that database; arrays need an element; strings need text. */
export function hasValue(config: ProjectConfig, path: string): boolean {
  let cur: unknown = config;
  for (const seg of path.split(".")) {
    if (Array.isArray(cur)) cur = cur.find((e) => (e as { slug?: string }).slug === seg);
    else if (cur !== null && typeof cur === "object") cur = (cur as Record<string, unknown>)[seg];
    else return false;
  }
  if (cur === null || cur === undefined) return false;
  if (Array.isArray(cur)) return cur.length > 0;
  if (typeof cur === "string") return cur.trim() !== "";
  return true;
}
