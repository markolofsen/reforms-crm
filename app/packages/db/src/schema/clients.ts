import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Mark } from "@hub/config";

// A client row exists only because the agent made a draft for that client (decision 0009): Notion holds the record,
// this table holds the key the local state (marks, drafts, log) hangs on. Never delete a row: marks cascade.
export const clients = sqliteTable(
  "clients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    repliesOwed: integer("replies_owed", { mode: "boolean" }).notNull().default(false),
    lastContactAt: text("last_contact_at"),
    // P90: the client's Notion stamp (`Last sent at` / `Last sent by`, P89) as Sent detection last read it, when another
    // person wrote it (never this Mac's own name). The open card says so when it is newer than the client's last message.
    teamSentAt: text("team_sent_at"),
    teamSentBy: text("team_sent_by"),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    // Last time the agent (or a test) refreshed this row: repliesOwed and lastContactAt are "as of" this moment.
    // The migration gives existing rows a constant default; every insert fills it in code.
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [uniqueIndex("clients_project_email").on(t.project, t.email)],
);

export const marks = sqliteTable(
  "marks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    mark: text("mark").$type<Mark>().notNull(),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("marks_client_mark").on(t.clientId, t.mark), index("marks_project").on(t.project)],
);
