// The one schema of a project (P19). Pure: zod and values.ts only, so @hub/notion can import `@hub/projects/parse` alone.
// `ProjectBase` is the resolved shape every consumer reads (parser, doctor, router, registry, installer, skills);
// `Kind` is the data a kind of project declares. A `Kind` is validated here, its instances live in kinds.ts.
import { z } from "zod";
import { BCP47, isIsoDate, isTimezone, SLUG } from "./values";

export const STATUSES = ["draft", "active", "paused", "archived"] as const;
/** `archived` behaves as `paused` for routing (nothing runs); the folder stays where it is. */
export type ProjectStatus = (typeof STATUSES)[number];
export const BYS = ["owner", "default", "agent"] as const;
export type By = (typeof BYS)[number];
/** The knowledge base is the local folder `knowledge/`; there is one source, `files`. */
export type KnowledgeSource = "files";

export const SEND_MODES = ["draft", "auto"] as const;
export type SendMode = (typeof SEND_MODES)[number];

export const MODULES = ["mail", "calendar", "knowledge", "filters", "notion", "bulk", "sequences"] as const;
export const Module = z.enum(MODULES);
export type Module = z.infer<typeof Module>;

const Tz = z.string().refine(isTimezone, "not an IANA timezone");
const Lang = z.string().regex(BCP47);
const IsoDate = z.string().refine(isIsoDate, "not an ISO date");

export const ProjectDatabase = z.object({ slug: z.string(), dataSourceId: z.string() });
export type ProjectDatabase = z.infer<typeof ProjectDatabase>;

/**
 * One row of `## Brands` (P60): a product the project answers for, the addresses and domains its mail arrives at, and
 * the lines that sign a draft for it. `name` is the exact Notion `Brand` option; `receivesAt` holds normalised
 * addresses and lower-case domains; `signature` is empty until the owner answered it.
 */
export const Brand = z.object({
  name: z.string().min(1),
  receivesAt: z.array(z.string()).default([]),
  signature: z.array(z.string()).default([]),
  answered: z.string().default(""),
  by: z.enum(BYS).default("owner"),
});
export type Brand = z.infer<typeof Brand>;

/** `shared` (default): one knowledge base for every brand. `by-brand`: each entry names its brands, search filters by the thread's brand. */
export const KNOWLEDGE_SCOPES = ["shared", "by-brand"] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

export const ProjectBase = z.object({
  schema: z.literal(1),
  slug: z.string().min(1),
  /** Key of a kind in kinds.ts; an unknown kind is an error. */
  kind: z.string(),
  name: z.string(),
  status: z.enum(STATUSES).default("draft"),
  /** Modules the project uses: the kind's modules. */
  modules: z.array(Module).default([]),
  languages: z.array(Lang).min(1).default(["en"]),
  /** IANA name, or null: the host timezone applies. */
  timezone: Tz.nullable().default(null),
  /** `addresses` is every address routed to the project: the declared `mail.addresses` plus `aliases` (declared ones first, no duplicates). */
  mail: z
    .object({
      accounts: z.array(z.string()).default([]),
      addresses: z.array(z.string()).default([]),
      aliases: z.array(z.string()).default([]),
      /** Domains whose mail reaches this project through forwarding or a catch-all (P52): its own brands, told to the agent. */
      domains: z.array(z.string()).default([]),
      mailboxes: z.array(z.string()).default(["INBOX"]),
      sentMailbox: z.string().default("Sent Mail"),
      sender: z.string().nullable().default(null),
    })
    .default({ accounts: [], addresses: [], aliases: [], domains: [], mailboxes: ["INBOX"], sentMailbox: "Sent Mail", sender: null }),
  /** `test`: the global allow_list; `any`: anyone; a list: exactly these. */
  draft: z.object({ recipients: z.union([z.literal("test"), z.literal("any"), z.array(z.string()).min(1)]).default("test") }).default({ recipients: "test" }),
  tone: z.string().nullable().default(null),
  signoff: z.string().default(""),
  /** The `## Brands` table (P60); empty: the project has one brand and its drafts are signed with `signoff` alone. */
  brands: z.array(Brand).default([]),
  notion: z
    .object({
      teamspace: z.string().nullable().default(null),
      /** Notion page id (normalised) the deploy skill creates databases under; wins over `teamspace`. */
      parentPage: z.string().nullable().default(null),
      tokenFile: z.string().default("notion-token"),
      databases: z.array(ProjectDatabase).default([]),
    })
    .default({ teamspace: null, parentPage: null, tokenFile: "notion-token", databases: [] }),
  /** Calendar the `calendar` skill writes holds into; null fields: not set (the skill reports a calendar-problem, never guesses). */
  calendar: z
    .object({ name: z.string().nullable().default(null), id: z.string().nullable().default(null), timezone: Tz.nullable().default(null), /** P62: Google Calendar connectors (`gcal-<label>`) attached to this project. */ connector: z.array(z.string()).default([]) })
    .default({ name: null, id: null, timezone: null, connector: [] }),
  /** P62: Google Drive connectors (`gdrive-<label>`) attached to this project, and the folders a search stays under (empty: none). */
  drive: z.object({ connector: z.array(z.string()).default([]), folder: z.array(z.string()).default([]) }).default({ connector: [], folder: [] }),
  knowledge: z.object({ source: z.literal("files").default("files"), scope: z.enum(KNOWLEDGE_SCOPES).default("shared") }).default({ source: "files", scope: "shared" }),
  /**
   * What the hub may send (decision 0011). The agent has no send tool in any mode; `hub send` is the only sender.
   * `draft`: nothing is sent unless a person runs `hub send` (or presses Send in the admin). `auto`: `hub send --due`
   * sends the drafts of `classes` after a cancel window of `delayMinutes`, at most `dailyCap` per rolling 24 hours.
   */
  send: z
    .object({
      mode: z.enum(SEND_MODES).default("draft"),
      /** Mail classes (of the kind) that may be sent without a person; empty: none. */
      classes: z.array(z.string()).default([]),
      dailyCap: z.number().int().positive().default(5),
      delayMinutes: z.number().int().positive().max(1440).default(10),
    })
    .default({ mode: "draft", classes: [], dailyCap: 5, delayMinutes: 10 }),
  /**
   * `hub record-draft` and the evidence block (P28): `warn` records a missing or failing `context` and reports it,
   * `block` refuses the draft. null: warn until CONTEXT_BLOCK_FROM, block after (owner decision 2026-11-15).
   */
  context: z.object({ required: z.enum(["warn", "block"]).nullable().default(null) }).default({ required: null }),
  /** null: the global value applies. quietHours `off` is kept as "off". */
  run: z
    .object({ quietHours: z.string().nullable().default(null), maxMessages: z.number().int().positive().nullable().default(null), maxBudgetUsd: z.number().positive().nullable().default(null) })
    .default({ quietHours: null, maxMessages: null, maxBudgetUsd: null }),
  setup: z.object({ completed: IsoDate.nullable().default(null), doctor: z.string().nullable().default(null) }).default({ completed: null, doctor: null }),
});

export type ProjectConfig = z.infer<typeof ProjectBase>;

/** A value list of the knowledge taxonomy (knowledge/taxonomy.md): UPPER_SNAKE words. */
const Word = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

/** What a kind of project declares. Data only: no code per kind (guarded by test/kinds.test.ts). */
export const Kind = z.object({
  id: z.string().regex(SLUG),
  title: z.string(),
  description: z.string(),
  /** Modules a project of this kind uses. */
  modules: z.array(Module).min(1),
  /** Dotted paths of the resolved config that must have a value once the project is not a draft, e.g. `tone`, `notion.databases.clients`. */
  required: z.array(z.string()),
  /** Notion CRM pack modules (`_template/notion-crm/`) this kind deploys; empty: no Notion CRM. */
  notionModules: z.array(z.string()),
  /** Mail classification set: the gmail label is `hub/<id>`. `generic` is the set every rule file written so far uses. */
  mailClasses: z.array(z.object({ id: z.string(), /** May leave the inbox. */ skippable: z.boolean().default(false), /** Gmail "never send to spam": client-facing mail. */ neverSpam: z.boolean().default(false), /** Gmail palette name of the label (`@hub/mail-filters` palette). */ color: z.string().default("Silver"), /** `count-only`: triage reports a count and reads nothing. */ triage: z.enum(["read", "count-only"]).default("read") })).min(1),
  /** Autosend: the mail classes a project of this kind may list in `send.classes` (client-facing replies, never security, spam, marketing or calendar), and the defaults of the cap and the window. */
  send: z.object({ classes: z.array(z.string()), dailyCap: z.number().int().positive(), delayMinutes: z.number().int().positive() }),
  /** Skills a bound session of this kind may use. */
  skills: z.array(z.string()),
  defaults: z.object({ languages: z.array(Lang).min(1), toneHint: z.string().optional() }),
  /** Starting taxonomy that `project-setup` copies to `knowledge/taxonomy.md`; the project owns it afterwards. */
  taxonomy: z.object({ audiences: z.array(Word), category: z.array(Word), stages: z.array(Word) }),
});
export type Kind = z.infer<typeof Kind>;
