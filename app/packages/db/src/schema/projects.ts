import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft | active | paused | archived
  kind: text("kind").notNull().default("generic"), // a key of the kind registry (@hub/projects kinds.ts), derived from project.md
  archived: integer("archived", { mode: "boolean" }).notNull().default(false), // status = archived, kept as a column to filter on
  settingsJson: text("settings_json").notNull(),
  hash: text("hash").notNull(), // sha256 of project.md
  syncedAt: text("synced_at").notNull(),
});

// One row per address or Mail account a project claims. An *address* is claimed by one project (unique index
// below: a duplicate is a hard error at sync, not a coin flip at run time). An *account* may be shared by several
// projects that receive through aliases, so accounts are not unique.
export const projectAddresses = sqliteTable(
  "project_addresses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    address: text("address").notNull(), // lower-case, +tag stripped
    project: text("project").notNull(),
    kind: text("kind").$type<"account" | "address" | "domain">().notNull(), // domain: a `mail.domains` entry (P60), one project each
  },
  (t) => [
    uniqueIndex("project_addresses_address").on(t.address).where(sql`${t.kind} = 'address'`),
    uniqueIndex("project_addresses_domain").on(t.address).where(sql`${t.kind} = 'domain'`),
    uniqueIndex("project_addresses_claim").on(t.project, t.address, t.kind),
  ],
);

// At most one open question per project (partial unique index): the owner is asked one thing at a time.
export const projectQuestions = sqliteTable(
  "project_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    field: text("field").notNull(),
    question: text("question").notNull(),
    optionsJson: text("options_json"),
    defaultValue: text("default_value"),
    status: text("status").$type<"open" | "answered">().notNull().default("open"),
    askedAt: text("asked_at").notNull(),
    answeredAt: text("answered_at"),
    answer: text("answer"),
  },
  (t) => [
    uniqueIndex("project_questions_one_open").on(t.project).where(sql`${t.status} = 'open'`),
    index("project_questions_project").on(t.project, t.status),
  ],
);
