import { z } from "zod";
import { mailReadDto } from "./inbound";
import { healthDto } from "./health";

/**
 * The Overview, contract v5 (P48): what needs the owner, said once per project. Everything is local (SQLite, the project
 * folders and the server's own loops), read in the request: there is no live Mail or Notion read, so no freshness stamp.
 * One-project instances show `status` as the Mail status line; two or more get the Overview table, one row per project.
 * No schema here has a field for a client name, address, subject, body, deal value or Notion property (decision 0013):
 * `strictObject` makes a stray field a parse failure on the server.
 */

/** `clear`: nothing to do. `attention`: a person should decide or look. `blocked`: nothing can be sent until it is fixed. */
export const STATUS_LEVELS = ["clear", "attention", "blocked"] as const;
export type StatusLevel = (typeof STATUS_LEVELS)[number];

/** Which fact the sentence states: the worst one of the project. `clear` has its own kind, so a scenario can name it. */
export const STATUS_KINDS = [
  "clear",
  "send-stopped",
  "sent-loop-error",
  "doctor-fail",
  "injection-flagged",
  "send-failed",
  "sending-stuck",
  "project-draft",
  "recipients-test",
  "fake-mailer",
  "cap-near",
  "knowledge-expired",
  "never-triaged",
  "context-block-soon",
] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/**
 * Where the worst fact is fixed: the nav targets that can carry a dot (P70: Overview, Knowledge, and the Settings panes Sending,
 * Mail, Agent, Connections, This Mac; P71 M3: `messengers` is Settings ▸ Messengers, where a parked account and the bot are). A fact fixed by a phrase in a session (a failing setup check, a draft project) names
 * Overview, where its "Needs you" item carries the phrase. The server never writes a URL: the admin maps it to `paths.*`.
 * Null: nowhere but the list itself.
 */
export const STATUS_NEXT = ["overview", "knowledge", "sending", "mail", "agent", "connections", "mac", "messengers"] as const;
export type StatusNext = (typeof STATUS_NEXT)[number];

/**
 * One project's standing. `sentence` is the worst fact in plain words, said once ("Sending is stopped", "All clear");
 * `next` is at most one place that fixes it. `numbers` are the two the line adds; the to-review count belongs to the
 * View menu and the nav, never repeated here.
 */
export const statusDto = z.strictObject({
  level: z.enum(STATUS_LEVELS),
  kind: z.enum(STATUS_KINDS),
  sentence: z.string(),
  next: z.enum(STATUS_NEXT).nullable(),
  numbers: z.strictObject({
    /**
     * Clients that wait for an answer, one client once (P96 verdict 5): those the agent left to the owner, and those whose
     * message the Mail reader found with no draft or agent record after it.
     */
    owed: z.number().int(),
    /** P96: the clients who wrote and have no draft yet (the Mail ▸ Inbox view), part of `owed`. */
    wrote: z.number().int(),
    /** P97: the people in the Inbox's Leads group (Notion Leads, New, in the window, no draft yet); absent when none. */
    leads: z.number().int().optional(),
    /** P96: when the Mail reader last read this project's mail, or why it does not (`reason`), and the unknown senders it counted. */
    mailRead: mailReadDto,
    /** When the agent last recorded a client; null = never triaged. */
    lastTriageAt: z.string().nullable(),
  }),
});
export type StatusDto = z.infer<typeof statusDto>;

/** One row of the multi-project Overview table (and, for a one-project instance, the source of the Mail status line). */
export const projectRowDto = z.strictObject({
  slug: z.string(),
  name: z.string(),
  /** The project's own status word (`draft`, `active`, `paused`, `archived`). */
  projectStatus: z.string(),
  archived: z.boolean(),
  toReview: z.number().int(),
  /** Sent since the project's local midnight, manual and auto. */
  sentToday: z.number().int(),
  status: statusDto,
});
export type ProjectRowDto = z.infer<typeof projectRowDto>;

export const overviewDto = z.strictObject({
  serverTime: z.string(),
  /** The host's IANA zone. */
  timeZone: z.string(),
  dataVersion: z.number().int(),
  /** Counts projects, not items: "2 projects need you", "All clear". */
  sentence: z.string(),
  projects: z.array(projectRowDto),
  system: healthDto,
});
export type OverviewDto = z.infer<typeof overviewDto>;
