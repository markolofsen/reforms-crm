import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { knowledgeDocs, projects } from "../schema";

export type KnowledgeDocRow = typeof knowledgeDocs.$inferSelect;
export type NewKnowledgeDoc = {
  path: string;
  title: string;
  use: "STATE" | "MARKER";
  approved: boolean;
  audiences: string[];
  /** P60: `## Brands` names or `ANY`; empty in a `shared` project. */
  brands?: string[];
  category?: string | null;
  kind?: string | null;
  validUntil?: string | null;
  body: string;
  phrasings: string;
  frontMatter: Record<string, unknown>;
  contentHash: string;
};

export type SearchOptions = {
  /** Only entries that list it or `ANY`. An entry with no audiences is visible to no audience-filtered search. */
  audience?: string;
  /**
   * P60, a `knowledge.scope by-brand` project only: entries listing this brand or `ANY`. `ANY` itself returns only the
   * shared entries (an unbranded mail). Unlike `audience` an entry's `brands` is never empty in such a project.
   */
  brand?: string;
  /** 1..10, default 5. */
  limit?: number;
  /** `approved` (default) drops unapproved and expired entries; `all` returns them, flagged. */
  include?: "approved" | "all";
  /** Injectable clock for `valid_until`. */
  today?: string;
};

export type SearchHit = {
  path: string;
  title: string;
  snippet: string;
  use: "STATE" | "MARKER";
  approved: boolean;
  expired: boolean;
  audiences: string[];
  brands: string[];
  category: string | null;
  validUntil: string | null;
  score: number;
};

const MAX_TOKENS = 16;
const SNIPPET_MAX = 400;

/**
 * Turns free text into an FTS5 MATCH expression: every token is a quoted prefix term, joined by OR. Text is never
 * passed to MATCH raw (FTS syntax injection: `"`, `*`, `NEAR`, column filters). Returns null when no token is left.
 */
export function buildMatchQuery(text: string): string | null {
  const found = text.normalize("NFC").match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const unique = [...new Set(found.map((t) => t.toLowerCase()))];
  const long = unique.filter((t) => [...t].length >= 2);
  const tokens = (long.length ? long : unique).slice(0, MAX_TOKENS);
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(" OR ") : null;
}

const parseAudiences = (json: string): string[] => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export const isExpired = (validUntil: string | null, today: string): boolean =>
  validUntil !== null && validUntil.slice(0, 10) < today;

export function knowledgeRepo(db: Db) {
  const requireProject = (slug: string) => {
    const row = db.select({ slug: projects.slug }).from(projects).where(eq(projects.slug, slug)).get();
    if (!row) throw new RepoError("unknown_project", `unknown_project: "${slug}" is not in the registry (run \`pnpm hub project sync\`)`);
  };

  return {
    /** Inserts or updates one entry by (project, path). FTS follows through the triggers. */
    async upsert(project: string, doc: NewKnowledgeDoc, at: string = new Date().toISOString()): Promise<void> {
      requireProject(project);
      const values = {
        project,
        path: doc.path,
        title: doc.title,
        use: doc.use,
        approved: doc.approved,
        audiences: JSON.stringify(doc.audiences),
        brands: JSON.stringify(doc.brands ?? []),
        category: doc.category ?? null,
        kind: doc.kind ?? null,
        validUntil: doc.validUntil ?? null,
        body: doc.body,
        phrasings: doc.phrasings,
        frontMatter: JSON.stringify(doc.frontMatter),
        contentHash: doc.contentHash,
        updatedAt: at,
      };
      db.insert(knowledgeDocs)
        .values(values)
        .onConflictDoUpdate({ target: [knowledgeDocs.project, knowledgeDocs.path], set: values })
        .run();
    },

    /** Deletes the project's rows whose path is not in `keepPaths`. Returns the number deleted. */
    async deleteMissing(project: string, keepPaths: string[]): Promise<number> {
      requireProject(project);
      const keep = new Set(keepPaths);
      const gone = db
        .select({ id: knowledgeDocs.id, path: knowledgeDocs.path })
        .from(knowledgeDocs)
        .where(eq(knowledgeDocs.project, project))
        .all()
        .filter((r) => !keep.has(r.path))
        .map((r) => r.id);
      for (let i = 0; i < gone.length; i += 500) {
        db.delete(knowledgeDocs).where(inArray(knowledgeDocs.id, gone.slice(i, i + 500))).run();
      }
      return gone.length;
    },

    async hashes(project: string): Promise<Map<string, string>> {
      requireProject(project);
      const rows = db
        .select({ path: knowledgeDocs.path, hash: knowledgeDocs.contentHash })
        .from(knowledgeDocs)
        .where(eq(knowledgeDocs.project, project))
        .all();
      return new Map(rows.map((r) => [r.path, r.hash]));
    },

    async get(project: string, path: string): Promise<KnowledgeDocRow | null> {
      requireProject(project);
      return (
        db
          .select()
          .from(knowledgeDocs)
          .where(and(eq(knowledgeDocs.project, project), eq(knowledgeDocs.path, path)))
          .get() ?? null
      );
    },

    async list(project: string): Promise<KnowledgeDocRow[]> {
      requireProject(project);
      return db.select().from(knowledgeDocs).where(eq(knowledgeDocs.project, project)).orderBy(knowledgeDocs.path).all();
    },

    /** Indexed entries whose `valid_until` day is before `today` (YYYY-MM-DD): the same rule as `isExpired`, counted in the index. */
    async expiredCount(project: string, today: string): Promise<number> {
      requireProject(project);
      return db
        .select({ n: sql<number>`count(*)` })
        .from(knowledgeDocs)
        .where(and(eq(knowledgeDocs.project, project), isNotNull(knowledgeDocs.validUntil), sql`substr(${knowledgeDocs.validUntil}, 1, 10) < ${today}`))
        .get()?.n ?? 0;
    },

    async count(project: string): Promise<number> {
      requireProject(project);
      return db.select({ n: sql<number>`count(*)` }).from(knowledgeDocs).where(eq(knowledgeDocs.project, project)).get()?.n ?? 0;
    },

    /** Newest `updated_at` of the project's index, or null when it is empty. The gate compares it with file mtimes. */
    async lastIndexedAt(project: string): Promise<string | null> {
      requireProject(project);
      return db.select({ at: sql<string | null>`max(${knowledgeDocs.updatedAt})` }).from(knowledgeDocs).where(eq(knowledgeDocs.project, project)).get()?.at ?? null;
    },

    /**
     * bm25-ranked search inside one project: `d.project = ?` is in the same SQL as the MATCH, so another project's
     * row cannot come back. Title weighs 10, phrasings 6, body 1 (doc 16 section 5).
     */
    async search(project: string, query: string, opts: SearchOptions = {}): Promise<{ total: number; hits: SearchHit[] }> {
      requireProject(project);
      const match = buildMatchQuery(query);
      if (!match) throw new RepoError("empty_query", "empty_query: the query has no searchable word");
      const limit = Math.min(10, Math.max(1, Math.trunc(opts.limit ?? 5)));
      const today = opts.today ?? new Date().toISOString().slice(0, 10);

      const where: SQL[] = [sql`knowledge_fts match ${match}`, sql`d.project = ${project}`];
      if ((opts.include ?? "approved") === "approved") {
        where.push(sql`d.approved = 1`, sql`(d.valid_until is null or substr(d.valid_until, 1, 10) >= ${today})`);
      }
      if (opts.audience) {
        where.push(sql`exists (select 1 from json_each(d.audiences) where value in (${opts.audience}, 'ANY'))`);
      }
      if (opts.brand) {
        where.push(opts.brand === "ANY" ? sql`exists (select 1 from json_each(d.brands) where value = 'ANY')` : sql`exists (select 1 from json_each(d.brands) where value in (${opts.brand}, 'ANY'))`);
      }
      const cond = sql.join(where, sql` and `);

      const total =
        db.get<{ n: number }>(
          sql`select count(*) as n from knowledge_fts join knowledge_docs d on d.id = knowledge_fts.rowid where ${cond}`,
        )?.n ?? 0;
      const rows = db.all<{
        path: string;
        title: string;
        use: "STATE" | "MARKER";
        approved: number;
        audiences: string;
        brands: string;
        category: string | null;
        validUntil: string | null;
        snippet: string;
        score: number;
      }>(sql`
        select d.path as path, d.title as title, d.use as use, d.approved as approved, d.audiences as audiences, d.brands as brands,
               d.category as category, d.valid_until as validUntil,
               snippet(knowledge_fts, -1, '', '', ' … ', 32) as snippet,
               -bm25(knowledge_fts, 10.0, 6.0, 1.0) as score
        from knowledge_fts join knowledge_docs d on d.id = knowledge_fts.rowid
        where ${cond}
        order by bm25(knowledge_fts, 10.0, 6.0, 1.0), d.path
        limit ${limit}`);

      return {
        total,
        hits: rows.map((r) => ({
          path: r.path,
          title: r.title,
          snippet: r.snippet.length > SNIPPET_MAX ? `${r.snippet.slice(0, SNIPPET_MAX - 1)}…` : r.snippet,
          use: r.use,
          approved: r.approved === 1,
          expired: isExpired(r.validUntil, today),
          audiences: parseAudiences(r.audiences),
          brands: parseAudiences(r.brands),
          category: r.category,
          validUntil: r.validUntil,
          score: Math.round(r.score * 1000) / 1000,
        })),
      };
    },
  };
}
