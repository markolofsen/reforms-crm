import { newThreadKey, NOTION_KINDS } from "@hub/config";
import { createRepos, openDb } from "@hub/db";
import { contextSchema, type Context } from "@hub/projects/context";

// The checks a draft record runs before it is written (moved from `hub record-draft`, P129 A3): the open draft a revision
// inherits from, and the knowledge entries of another brand (P60). What the draft was based on is never judged (P140 K2).

/** One finding of the record's checks (P60 `fact-other-brand`). Red unless `amber`. */
export interface Finding { code: string; text: string; amber: boolean }

const ADDRESS = /[^\s,;<>"']+@[^\s,;<>"']+/g;
export const addressesOf = (...fields: Array<string | null | undefined>): string[] => fields.flatMap((f) => f?.match(ADDRESS) ?? []);

export interface PreviousRevision {
  name: string | null;
  context: Context | null;
  notion: { kind: (typeof NOTION_KINDS)[number]; pageId?: string; url?: string } | null;
  to: string | null;
  cc: string | null;
  reason: string | null;
  mailClass: string | null;
}

/** The client's open draft (ready or hold) with this mailRef, read before the write; null when there is none or the database cannot be read. */
export async function previousRevision(dbPath: string, project: string, email: string, mailRef: string): Promise<PreviousRevision | null> {
  const bare = (x: string | null | undefined) => (x ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
  let handle: ReturnType<typeof openDb> | undefined;
  try {
    handle = openDb(dbPath);
    const repos = createRepos(handle.db);
    const clientId = await repos.clients.idByEmail(project, email.trim());
    if (clientId === undefined) return null;
    const client = await repos.clients.get(project, clientId);
    const hit = (await repos.drafts.ofClient(project, clientId)).find((d) => (d.status === "ready" || d.status === "hold") && bare(d.mailRef ?? (d.context?.includes('"newThread":true') ? newThreadKey(email) : "")) === bare(mailRef));
    if (!hit) return null;
    const ctx = hit.context ? contextSchema.safeParse(JSON.parse(hit.context)) : null;
    const kind = NOTION_KINDS.find((k) => k === hit.notionKind);
    const real = (n: string | null | undefined) => (n && n.trim().toLowerCase() !== email.trim().toLowerCase() ? n : null);
    return {
      name: real(client?.name),
      context: ctx?.success ? ctx.data : null,
      notion: kind ? { kind, ...(hit.notionPageId ? { pageId: hit.notionPageId } : {}), ...(hit.notionUrl ? { url: hit.notionUrl } : {}) } : null,
      to: hit.toAddr ?? null,
      cc: hit.ccAddr ?? null,
      reason: hit.reason ?? null,
      mailClass: hit.mailClass ?? null,
    };
  } catch {
    return null;
  } finally {
    handle?.close();
  }
}

/** The used entries (by path, or a path suffix such as an id) whose `brands` list neither `brand` nor ANY. Unreadable index: nothing is claimed. */
export async function otherBrandFacts(dbPath: string, project: string, used: readonly string[], brand: string | null): Promise<Finding[]> {
  let handle: ReturnType<typeof openDb> | undefined;
  try {
    handle = openDb(dbPath);
    const rows = await createRepos(handle.db).knowledge.list(project);
    const out: Finding[] = [];
    for (const u of used) {
      const id = u.trim();
      const row = rows.find((r) => r.path === id) ?? rows.find((r) => id.length >= 6 && (r.path.endsWith(id) || r.path.endsWith(`${id}.md`) || r.path.includes(`-${id}`)));
      if (!row) continue;
      let brands: string[] = [];
      try { const j: unknown = JSON.parse(row.brands); brands = Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : []; } catch { brands = []; }
      if (brands.includes("ANY") || (brand !== null && brands.includes(brand))) continue;
      out.push({ code: "fact-other-brand", text: `${row.path} is a fact of ${brands.join(", ") || "no brand"}, and this draft answers ${brand ?? "a mail with no brand"}`, amber: false });
    }
    return out;
  } catch {
    return [];
  } finally {
    handle?.close();
  }
}
