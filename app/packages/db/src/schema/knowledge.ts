import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// The knowledge index. `knowledge_fts` (FTS5, external content over this table) is created by a hand-written
// migration with its triggers: drizzle cannot model virtual tables.
export const knowledgeDocs = sqliteTable(
  "knowledge_docs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    path: text("path").notNull(), // relative to the project folder
    title: text("title").notNull(),
    use: text("use").$type<"STATE" | "MARKER">().notNull().default("STATE"),
    approved: integer("approved", { mode: "boolean" }).notNull().default(true),
    audiences: text("audiences").notNull().default("[]"), // JSON array
    brands: text("brands").notNull().default("[]"), // JSON array of `## Brands` names or ANY (P60); read only in a knowledge.scope by-brand project
    category: text("category"),
    kind: text("kind"),
    validUntil: text("valid_until"),
    body: text("body").notNull().default(""),
    phrasings: text("phrasings").notNull().default(""),
    frontMatter: text("front_matter").notNull().default("{}"), // JSON, as read from the file
    contentHash: text("content_hash").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("knowledge_docs_project_path").on(t.project, t.path)],
);

// ---- Messengers (P8). Messages are stored locally because the Bot API has no history call. Text is kept
// in full (the owner's own machine) and every row carries `retain_until` (90 days); a purge job deletes past it.
