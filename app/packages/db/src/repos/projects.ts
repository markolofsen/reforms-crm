import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { write } from "../tx";
import { RepoError } from "../errors";
import { agentRuns, clients, projectAddresses, projectQuestions, projects } from "../schema";

export type ProjectRow = typeof projects.$inferSelect;
export type AddressRow = { address: string; project: string; kind: "account" | "address" | "domain" };
export type QuestionRow = typeof projectQuestions.$inferSelect;
export type NewProjectRow = Omit<ProjectRow, "syncedAt" | "kind" | "archived"> & { kind?: string; archived?: boolean };
export type NewQuestion = {
  field: string;
  question: string;
  options?: string[];
  defaultValue?: string;
  at?: string;
};

const now = () => new Date().toISOString();

export function projectsRepo(db: Db) {
  const requireProject = (slug: string) => {
    const row = db.select({ slug: projects.slug }).from(projects).where(eq(projects.slug, slug)).get();
    if (!row) throw new RepoError("unknown_project", `unknown_project: "${slug}" is not in the registry (run \`pnpm hub project sync\`)`);
  };

  return {
    /** Throws `unknown_project` unless `slug` is registered. Every project-scoped write of P7 calls it first. */
    requireProject,

    /**
     * Registered slugs, plus any `project` value already used by rows written before the registry existed (so a
     * database that was never synced still lists its projects). After a sync the first set is the truth.
     */
    async list(): Promise<string[]> {
      const rows = db.all<{ project: string }>(
        sql`select slug as project from ${projects} union select project from ${clients} union select project from ${agentRuns} order by project`,
      );
      return rows.map((r) => r.project);
    },

    async get(slug: string): Promise<ProjectRow | null> {
      return db.select().from(projects).where(eq(projects.slug, slug)).get() ?? null;
    },

    /** Everything the router needs, in one read. Cross-project on purpose: only the gate and `doctor` call it. */
    async registry(): Promise<{ projects: ProjectRow[]; addresses: AddressRow[] }> {
      return {
        projects: db.select().from(projects).orderBy(asc(projects.slug)).all(),
        addresses: db
          .select({ address: projectAddresses.address, project: projectAddresses.project, kind: projectAddresses.kind })
          .from(projectAddresses)
          .orderBy(asc(projectAddresses.project), asc(projectAddresses.address))
          .all(),
      };
    },

    /** Replaces the whole registry in one transaction. Open and answered questions are not touched. */
    async replaceRegistry(input: { projects: NewProjectRow[]; addresses: AddressRow[]; at?: string }): Promise<void> {
      const at = input.at ?? now();
      try {
        write(db, (tx) => {
          tx.delete(projectAddresses).run();
          tx.delete(projects).run();
          for (const p of input.projects) tx.insert(projects).values({ ...p, syncedAt: at }).run();
          for (const a of input.addresses) tx.insert(projectAddresses).values(a).run();
        });
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed: project_addresses/.test(err.message)) {
          throw new RepoError("duplicate_claim", `duplicate_claim: ${err.message}`);
        }
        throw err;
      }
    },

    /** Opens a question unless the project already has one open (one question at a time, doc 16 section 8). */
    async openQuestion(project: string, q: NewQuestion): Promise<{ id: number; created: boolean }> {
      requireProject(project);
      const existing = db
        .select({ id: projectQuestions.id })
        .from(projectQuestions)
        .where(and(eq(projectQuestions.project, project), eq(projectQuestions.status, "open")))
        .get();
      if (existing) return { id: existing.id, created: false };
      const row = db
        .insert(projectQuestions)
        .values({
          project,
          field: q.field,
          question: q.question,
          optionsJson: q.options ? JSON.stringify(q.options) : null,
          defaultValue: q.defaultValue ?? null,
          askedAt: q.at ?? now(),
        })
        .returning({ id: projectQuestions.id })
        .get();
      return { id: row.id, created: true };
    },

    /** Records the owner's answer on the open question. Returns false when nothing was open. */
    async answerQuestion(project: string, answer: string, at: string = now()): Promise<boolean> {
      requireProject(project);
      const res = db
        .update(projectQuestions)
        .set({ status: "answered", answer, answeredAt: at })
        .where(and(eq(projectQuestions.project, project), eq(projectQuestions.status, "open")))
        .run();
      return res.changes > 0;
    },

    async questions(project: string, status?: "open" | "answered"): Promise<QuestionRow[]> {
      requireProject(project);
      const where = status
        ? and(eq(projectQuestions.project, project), eq(projectQuestions.status, status))
        : eq(projectQuestions.project, project);
      return db.select().from(projectQuestions).where(where).orderBy(asc(projectQuestions.id)).all();
    },

    /** Admin header badge and `doctor`: the one cross-project count. */
    async openQuestionCount(): Promise<number> {
      return db.select({ n: sql<number>`count(*)` }).from(projectQuestions).where(eq(projectQuestions.status, "open")).get()?.n ?? 0;
    },
  };
}
