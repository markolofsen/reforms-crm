import { z } from "zod";

/**
 * The Knowledge table (P70, `GET /api/projects/:slug/knowledge`): every entry of a project's knowledge index, one row each, read
 * from the index only (no file read). An entry is named by its title and its Open key (`knowledge:<path>`, P61 `entryKey`), never
 * by an absolute path; its body and phrasings stay on the server. Strict: a stray field is a parse failure.
 */

/** An entry's standing, worst first: past its `valid_until` day, not approved, valid until within `EXPIRING_DAYS`, approved. */
export const KNOWLEDGE_STATUSES = ["expired", "unapproved", "expiring", "approved"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

/** The View menu of the table (`?filter=`): every entry, the ones that need a look (any status but approved, or no audience), and two narrower ones. */
export const KNOWLEDGE_VIEWS = ["all", "attention", "expired", "unapproved"] as const;
export type KnowledgeView = (typeof KNOWLEDGE_VIEWS)[number];

export const EXPIRING_DAYS = 14;
/** The most rows one read returns; a base past it says so (saas holds about 60). */
export const KNOWLEDGE_MAX_ROWS = 500;

export const knowledgeEntryDto = z.strictObject({
  key: z.string().startsWith("knowledge:"),
  title: z.string(),
  use: z.enum(["STATE", "MARKER"]),
  approved: z.boolean(),
  audiences: z.array(z.string()),
  brands: z.array(z.string()),
  category: z.string().nullable(),
  kind: z.string().nullable(),
  validUntil: z.string().nullable(),
  status: z.enum(KNOWLEDGE_STATUSES),
});
export type KnowledgeEntryDto = z.infer<typeof knowledgeEntryDto>;

export const knowledgeListDto = z.strictObject({
  /** `by-brand`: the table shows each entry's brands beside its audiences (P60). */
  scope: z.enum(["shared", "by-brand"]),
  /** The rows of the asked view and search, title order, at most `KNOWLEDGE_MAX_ROWS`. */
  entries: z.array(knowledgeEntryDto),
  /** Every view's size for the search (the View menu's counts, `admin-principles.md` rule 11). */
  counts: z.strictObject({ all: z.number().int(), attention: z.number().int(), expired: z.number().int(), unapproved: z.number().int() }),
  /** More rows matched than were returned. */
  truncated: z.boolean(),
});
export type KnowledgeListDto = z.infer<typeof knowledgeListDto>;

const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The status of an entry on `today` (`YYYY-MM-DD`, the project's local day): the same day rule as the index's `isExpired`. Pure. */
export function entryStatus(e: { approved: boolean; validUntil: string | null }, today: string): KnowledgeStatus {
  const day = e.validUntil?.slice(0, 10) ?? null;
  if (day !== null && day < today) return "expired";
  if (!e.approved) return "unapproved";
  if (day !== null && day <= addDays(today, EXPIRING_DAYS)) return "expiring";
  return "approved";
}

/** Whether an entry belongs to a view. "Needs a look" also holds an approved entry no audience can find. */
export function inView(e: Pick<KnowledgeEntryDto, "status" | "audiences">, view: KnowledgeView): boolean {
  if (view === "all") return true;
  if (view === "attention") return e.status !== "approved" || e.audiences.length === 0;
  return e.status === view;
}

/** The topic of an entry with no folder and no category (P74). */
export const OTHER_TOPIC = "Other";

/**
 * A topic code or folder name as words (P74): `ABOUT_DAN` is "About dan", `four-seasons-nevis` "Four seasons nevis"; an upper-case
 * code of three letters or fewer stays as written (`API`), since it is an acronym, not a word.
 */
export function topicLabel(code: string): string {
  if (/^[A-Z0-9]{1,3}$/.test(code)) return code;
  const words = code.toLowerCase().replaceAll(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Where an entry sits (P74), as labels from the outside in: its folder, one label per directory under `knowledge/files/` or
 * `knowledge/notion/` (`playbooks/client` is ["Playbooks", "Client"]); an entry directly in the base falls under its `category`;
 * neither is `OTHER_TOPIC`. Read from the row's Open key (P61), so it needs no field, no reindex and no server change. Pure.
 */
export function entryTopic(key: string, category: string | null): readonly string[] {
  const parts = key.replace(/^knowledge:/, "").split("/").slice(0, -1);
  if (parts[0] === "knowledge") parts.shift();
  if (parts[0] === "files" || parts[0] === "notion") parts.shift();
  const dirs = parts.filter((p) => p !== "");
  if (dirs.length > 0) return dirs.map(topicLabel);
  const c = category?.trim() ?? "";
  return [c === "" ? OTHER_TOPIC : topicLabel(c)];
}
