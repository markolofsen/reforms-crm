// P89 (decision 0043 point 7): the Hub's ONE Notion write. After a confirmed send it writes two fields on the client's Clients page,
// `Last sent at` (date) and `Last sent by` (text: the sender's setup name), so a team on one instance sees who wrote to a client last.
// The writer can set exactly those two properties and nothing else: there is no generic page update here. Everything else of this
// package stays read only (`read.ts`). A failure never reaches the send: the caller logs it to the ops log.
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import notionhq from "@notionhq/client";
import { readPerson } from "@hub/config/person";
import { ops } from "@hub/log/ops";
import { projectStore } from "@hub/projects/store";
import { findClientByEmail, findClientPage, textOf } from "./client-lookup";
import { createNotionReader } from "./notion";
import type { NotionReader } from "./types";

export const STAMP_FIELDS = { at: "Last sent at", by: "Last sent by" } as const;

export interface StampWriter {
  /** Sets `Last sent at` to `at` (ISO date-time) and `Last sent by` to `by` on one page. */
  stamp(pageId: string, at: string, by: string): Promise<void>;
}

export function createStampWriter(token: string, options: { fetch?: typeof fetch } = {}): StampWriter {
  const client = new notionhq.Client({ auth: token, timeoutMs: 30_000, retry: { maxRetries: 2, initialRetryDelayMs: 1000, maxRetryDelayMs: 10_000 }, ...(options.fetch ? { fetch: options.fetch as never } : {}) });
  return {
    async stamp(pageId, at, by) {
      await client.pages.update({
        page_id: pageId,
        properties: {
          [STAMP_FIELDS.at]: { date: { start: at } },
          [STAMP_FIELDS.by]: { rich_text: [{ type: "text", text: { content: by.slice(0, 200) } }] },
        } as never,
      });
    },
  };
}

export type StampOutcome =
  | { state: "stamped"; pageId: string }
  | { state: "skipped"; reason: "fields_missing" | "not_client" | "do_not_contact"; detail: string };

/**
 * Finds the client by the address the mail went to (the read token's one filtered query, `findClientByEmail`) and stamps the page.
 * The Clients data source must have both fields with their types: an instance whose Notion lacks them is skipped, not written.
 */
export async function stampClientSend(deps: { reader: NotionReader; writer: StampWriter }, o: { clientsDataSource: string; email: string; at: string; by: string }): Promise<StampOutcome> {
  const ds = await deps.reader.retrieveDataSource(o.clientsDataSource);
  const at = ds.properties[STAMP_FIELDS.at], by = ds.properties[STAMP_FIELDS.by];
  if (at?.type !== "date" || by?.type !== "rich_text") {
    return { state: "skipped", reason: "fields_missing", detail: `the Clients database has no ${at?.type === "date" ? "" : `"${STAMP_FIELDS.at}" (date) `}${by?.type === "rich_text" ? "" : `"${STAMP_FIELDS.by}" (text)`}`.trim() };
  }
  const found = await findClientByEmail(deps.reader, o.clientsDataSource, o.email);
  if (found.state === "not_client") return { state: "skipped", reason: "not_client", detail: "no Clients row has this address" };
  if (found.state === "do_not_contact") return { state: "skipped", reason: "do_not_contact", detail: "the client is marked Do not contact" };
  await deps.writer.stamp(found.pageId, o.at, o.by);
  return { state: "stamped", pageId: found.pageId };
}

export interface StampEnv {
  projectsDir: string;
  /** `hubPaths().secrets`: the read token's folder (its file name is the project's `notion.token_file`). */
  secretsDir: string;
  /** `hubPaths().state`: `person.json`. */
  stateDir: string;
  /** Tests: the reader and the writer (default: the real ones with the project's token). */
  clients?: (token: string) => { reader: NotionReader; writer: StampWriter };
}

/** The name this Mac stamps with: the person's setup name, else the login name with the fix. */
export function stampName(stateDir: string): string {
  return readPerson({ state: stateDir })?.name ?? `${userInfo().username} (name not set: ./run.sh setup --person)`;
}

/** P90: the client's stamp as Notion holds it (`Last sent at` / `Last sent by`), or null when the client or a field is absent. Read only. */
export async function readClientStamp(reader: NotionReader, clientsDataSource: string, email: string): Promise<{ at: string; by: string } | null> {
  const found = await findClientPage(reader, clientsDataSource, email);
  if (found.state === "not_client") return null;
  const at = found.page.properties[STAMP_FIELDS.at];
  const start = at?.type === "date" && at.date && typeof at.date === "object" ? Reflect.get(at.date, "start") : null;
  const by = textOf(found.page.properties[STAMP_FIELDS.by]).trim();
  return typeof start === "string" && start && by ? { at: new Date(start).toISOString(), by } : null;
}

/**
 * P90: another person's stamp on the client this draft goes to, for the open card: null when the project has no clients
 * database or no token on this Mac, the client has no stamp, or the stamp carries this Mac's own name. Never throws: a
 * Notion failure is one ops-log line (`notion`) and null. Reads only.
 */
export async function teamStampOf(env: StampEnv, project: string, email: string): Promise<{ at: string; by: string } | null> {
  try {
    const p = projectStore({ projects: env.projectsDir }).config(project);
    const ds = p.notion.databases.find((d) => d.slug === "clients")?.dataSourceId;
    if (!ds) return null;
    let token = "";
    try { token = readFileSync(join(env.secretsDir, p.notion.tokenFile), "utf8").trim(); } catch { /* absent */ }
    if (!token) return null;
    const reader = env.clients?.(token).reader ?? createNotionReader(token);
    const stamp = await readClientStamp(reader, ds, email);
    return stamp && stamp.by !== stampName(env.stateDir) ? stamp : null;
  } catch (e) {
    const status: unknown = e && typeof e === "object" ? Reflect.get(e, "status") : undefined;
    ops("notion").warn("reading the client's Last sent stamp failed", { project, status: typeof status === "number" ? status : null, error: e instanceof Error ? e.name : "error" });
    return null;
  }
}

export type SentStampResult = StampOutcome | { state: "off" | "no_database" | "no_token" | "no_recipient"; detail: string } | { state: "failed"; detail: string };

/**
 * One confirmed send (the send door's `onSent`, or Sent detection) to the client's Clients page: the project's `notion.stamp_sends`,
 * its `clients` data source, the read token file, the person's name. Never throws; every outcome but `stamped` and `off` is one
 * ops-log line (`notion`), `stamped` is an info line. A Notion error is Notion's status and code, never its message.
 */
export async function stampSentMail(env: StampEnv, n: { project: string; to: readonly string[]; at: string; draftId: number; via: string }): Promise<SentStampResult> {
  const log = ops("notion");
  try {
    const p = projectStore({ projects: env.projectsDir }).config(n.project);
    if (p.notion.stampSends === "off") return { state: "off", detail: "notion.stamp_sends is off" };
    const ds = p.notion.databases.find((d) => d.slug === "clients")?.dataSourceId;
    if (!ds) { log.info("send not stamped in Notion: the project lists no clients database", { project: n.project, draft: n.draftId }); return { state: "no_database", detail: "no clients database in project.md" }; }
    const email = n.to.map((a) => (/<([^>]+)>/.exec(a)?.[1] ?? a).trim()).find((a) => a.includes("@"));
    if (!email) return { state: "no_recipient", detail: "the send had no address" };
    let token = "";
    try { token = readFileSync(join(env.secretsDir, p.notion.tokenFile), "utf8").trim(); } catch { /* absent */ }
    if (!token) { log.info("send not stamped in Notion: no read token on this Mac", { project: n.project, draft: n.draftId, file: p.notion.tokenFile }); return { state: "no_token", detail: `no ${p.notion.tokenFile} in state/secrets` }; }
    const by = stampName(env.stateDir);
    const c = env.clients?.(token) ?? { reader: createNotionReader(token), writer: createStampWriter(token) };
    const r = await stampClientSend(c, { clientsDataSource: ds, email, at: n.at, by });
    if (r.state === "stamped") log.info("send stamped in Notion (Last sent at, Last sent by)", { project: n.project, draft: n.draftId, via: n.via });
    else log.warn(`send not stamped in Notion: ${r.reason}`, { project: n.project, draft: n.draftId, detail: r.detail });
    return r;
  } catch (e) {
    const status: unknown = e && typeof e === "object" ? Reflect.get(e, "status") : undefined;
    const code: unknown = e && typeof e === "object" ? Reflect.get(e, "code") : undefined;
    // 403 restricted_resource: the integration has Read content only (OWNER item 26: give it Update content).
    log.warn("send not stamped in Notion: the write failed", { project: n.project, draft: n.draftId, status: typeof status === "number" ? status : null, kind: typeof code === "string" ? code : null, error: e instanceof Error ? e.name : "error" });
    return { state: "failed", detail: `${typeof status === "number" ? `HTTP ${status} ` : ""}${typeof code === "string" ? code : e instanceof Error ? e.name : "error"}` };
  }
}
