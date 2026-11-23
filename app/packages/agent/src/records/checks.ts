import { newThreadKey, NOTION_KINDS } from "@hub/config";
import { createRepos, openDb } from "@hub/db";
import { contextSchema, type Context, type Violation } from "@hub/projects/context";
import { observeDraft, type LedgerEntry } from "../evidence/ledger";
import { latestSession } from "../evidence/store";

// The checks a draft record runs before it is written (moved from `hub record-draft`, P129 A3): the claim against this
// session's ledger, the open draft a revision inherits from, and the knowledge entries of another brand.

/** One line of state/evidence/<slug>/records.jsonl: what a record said and what the ledger observed. No body. */
export interface RecordLine {
  at: string;
  batchKey?: string;
  email: string;
  name: string;
  mailRef: string;
  draftId: number;
  evidence: "ok" | "weak" | "missing";
  source: "observed" | "claimed";
  warnings: string[];
  context?: Context;
  /** Sketch of the reply, from the ledger (the agent cannot send another body than the one it created). */
  fp?: number[];
  /** Hash of the ledger's draft write this record claimed: another record cannot claim it again. */
  draftHash?: string;
  observed?: { read: number; required: number; profile: boolean; facts: number; maxSim: number };
}

/** Compares the claim with the newest session's ledger. Picks the reply of this client (by the address read), else the oldest reply not yet recorded. */
export function crossCheck(root: string, slug: string, email: string, ctx: Context | undefined, claimed: Set<string>): { entry?: LedgerEntry; observed?: RecordLine["observed"]; violations: Violation[] } {
  const s = latestSession(root, slug);
  if (!s) return { violations: [] };
  const drafts = s.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === "draft");
  const withClient = drafts.map(({ e, i }) => ({ e, i, ob: observeDraft(s.entries, i) }));
  const hit = [...withClient].reverse().find((x) => x.ob.client === email) ?? withClient.find((x) => !x.ob.client && !claimed.has(x.e.hash ?? ""));
  if (!hit) return { violations: [] };
  const { ob, e } = hit;
  const v: Violation[] = [];
  if (ctx) {
    if (ctx.thread.read > ob.read) v.push({ code: "claim-exceeds-observation", text: `claims ${ctx.thread.read} message(s) read, the session opened ${ob.read}`, amber: true });
    if (ctx.profile.read && !ob.profile) v.push({ code: "claim-exceeds-observation", text: "claims the profile was read, the session did not read it", amber: true });
    if (ctx.facts.queries > ob.facts) v.push({ code: "claim-exceeds-observation", text: `claims ${ctx.facts.queries} knowledge search(es), the session ran ${ob.facts}`, amber: true });
    if (e.figure && !e.placeholder && ctx.facts.used.length === 0) v.push({ code: "fact-without-source", text: "the body states a figure or date but no knowledge entry is listed", amber: true });
  }
  return { entry: e, observed: { read: ob.read, required: ob.required, profile: ob.profile, facts: ob.facts, maxSim: ob.maxSim }, violations: v };
}

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
export async function previousRevision(dbPath: string, project: string, email: string, mailRef: string, ledger: RecordLine[] = []): Promise<PreviousRevision | null> {
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
    // A revision recorded thin (before P52) left no context or a bare email as the name: the newest ledger line of this draft that had them.
    const lines = ledger.filter((l) => l.draftId === hit.id && l.email === email.trim().toLowerCase()).reverse();
    const fromLedger = lines.find((l) => l.context)?.context;
    return {
      name: real(client?.name) ?? real(lines.find((l) => real(l.name))?.name),
      context: ctx?.success ? ctx.data : (fromLedger ?? null),
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
export async function otherBrandFacts(dbPath: string, project: string, used: readonly string[], brand: string | null): Promise<Violation[]> {
  let handle: ReturnType<typeof openDb> | undefined;
  try {
    handle = openDb(dbPath);
    const rows = await createRepos(handle.db).knowledge.list(project);
    const out: Violation[] = [];
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
