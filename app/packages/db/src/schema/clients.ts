import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Mark } from "@hub/config";

// A client row exists only because the agent made a draft for that client (decision 0009): Notion holds the record,
// this table holds the key the local state (marks, drafts, log) hangs on. Never delete a row: marks cascade.
// P141 C1 (migration 0044): the key is `id`, and any one identity reaches it (`client_identifiers`); `email` is the primary address
// Mail uses, null for a client known only by a chat (unique per project when set). `notion_page_id` is its Notion card.
export const clients = sqliteTable(
  "clients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    email: text("email"),
    name: text("name").notNull(),
    repliesOwed: integer("replies_owed", { mode: "boolean" }).notNull().default(false),
    lastContactAt: text("last_contact_at"),
    // P90: the client's Notion stamp (`Last sent at` / `Last sent by`, P89) as Sent detection last read it, when another
    // person wrote it (never this Mac's own name). The open card says so when it is newer than the client's last message.
    teamSentAt: text("team_sent_at"),
    teamSentBy: text("team_sent_by"),
    // P135: the client map, Mermaid text the agent redraws after a draft (`client_map`), and when; every version is a `client_maps` row.
    map: text("map"),
    mapUpdatedAt: text("map_updated_at"),
    // P141 C1 (migration 0044): the client's Notion card, filled by the link and the directory read; unique per project when set.
    notionPageId: text("notion_page_id"),
    // P141 C4 (migration 0044): set on the newer client of a merge; the row stays (rule 16), and its id resolves to this one.
    mergedInto: integer("merged_into"),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    // Last time the agent (or a test) refreshed this row: repliesOwed and lastContactAt are "as of" this moment.
    // The migration gives existing rows a constant default; every insert fills it in code.
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("clients_project_email").on(t.project, t.email).where(sql`${t.email} is not null`),
    uniqueIndex("clients_project_notion_page").on(t.project, t.notionPageId).where(sql`${t.notionPageId} is not null`),
  ],
);

/** P135 verdict 1: every version of a client's map, newest last; the open sheet's "Previous" is the one before the newest. */
export const clientMaps = sqliteTable(
  "client_maps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    createdAt: text("created_at").notNull(),
    // P136 (migration 0037): the version's evidence (node id -> source refs) and the reasons for removed or renamed nodes, JSON.
    sources: text("sources"),
    reasons: text("reasons"),
  },
  (t) => [index("client_maps_client").on(t.clientId, t.id)],
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
