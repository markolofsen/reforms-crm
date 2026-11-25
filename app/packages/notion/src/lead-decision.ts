// P147 L7 (decision 0055 point 5): the pass's decision copied to the lead's Notion page, after each `lead_decide`. It writes exactly
// the two Hub-owned properties, `Hub decision` (select) and `Hub reason` (text), and only those the Leads data source has with the
// right type, so a database before `hub install --only notion.lead-pass` is skipped cleanly. Never Status, Owner or Notes (their
// writers are the owner and the send's convert), never a delete. A failure never reaches the decision: the caller gets a state
// and the ops log one line.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import notionhq from "@notionhq/client";
import { LEAD_PASS_NOTION, LEAD_PASS_NOTION_DECISION, type LeadPassDecision } from "@hub/config/lead-pass";
import { ops } from "@hub/log/ops";
import { projectStore } from "@hub/projects/store";
import { richTextChunks } from "./client-map";
import { createNotionReader } from "./notion";
import { notionSdkLog } from "./sdk-log";
import type { NotionReader } from "./types";

/** The two properties and the type each must have in the Leads data source. */
export const LEAD_DECISION_PROPERTY_TYPES: Record<(typeof LEAD_PASS_NOTION)[keyof typeof LEAD_PASS_NOTION], "select" | "rich_text"> = {
  [LEAD_PASS_NOTION.decision]: "select",
  [LEAD_PASS_NOTION.reason]: "rich_text",
};

export interface LeadDecisionWriter {
  setProperties(pageId: string, props: Record<string, unknown>): Promise<void>;
}

export function createLeadDecisionWriter(token: string, options: { fetch?: typeof fetch } = {}): LeadDecisionWriter {
  const client = new notionhq.Client({ auth: token, timeoutMs: 30_000, retry: { maxRetries: 2, initialRetryDelayMs: 1000, maxRetryDelayMs: 10_000 }, ...notionSdkLog, ...(options.fetch ? { fetch: options.fetch as never } : {}) });
  return {
    async setProperties(pageId, props) {
      await client.pages.update({ page_id: pageId, properties: props as never });
    },
  };
}

/** The property values of one decision, only for the properties the data source has with the right type. Pure. */
export function leadDecisionProperties(have: Record<string, { type: string } | undefined>, d: { decision: string; reason: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const label = LEAD_PASS_NOTION_DECISION[d.decision as LeadPassDecision] ?? d.decision;
  if (have[LEAD_PASS_NOTION.decision]?.type === "select") out[LEAD_PASS_NOTION.decision] = { select: { name: label } };
  if (have[LEAD_PASS_NOTION.reason]?.type === "rich_text") out[LEAD_PASS_NOTION.reason] = { rich_text: richTextChunks(d.reason.trim()) };
  return out;
}

export interface LeadDecisionSyncEnv {
  projectsDir: string;
  secretsDir: string;
  clients?: (token: string) => { reader: NotionReader; writer: LeadDecisionWriter };
}

export type LeadDecisionSyncResult = { state: "synced"; properties: number } | { state: "skipped"; detail: string } | { state: "no_database" | "no_token" | "failed"; detail: string };

/** One decision to the lead's Notion page. Never throws; every outcome but `synced` is one ops line (`notion`). */
export async function syncLeadDecision(env: LeadDecisionSyncEnv, n: { project: string; pageId: string; decision: string; reason: string }): Promise<LeadDecisionSyncResult> {
  const log = ops("notion");
  try {
    const p = projectStore({ projects: env.projectsDir }).config(n.project);
    const ds = p.notion.databases.find((d) => d.slug === "leads")?.dataSourceId;
    if (!ds) return { state: "no_database", detail: "no leads database in project.md" };
    let token = "";
    try {
      token = readFileSync(join(env.secretsDir, p.notion.tokenFile), "utf8").trim();
    } catch {
      token = "";
    }
    if (!token) return { state: "no_token", detail: `no ${p.notion.tokenFile} in state/secrets` };
    const c = env.clients?.(token) ?? { reader: createNotionReader(token), writer: createLeadDecisionWriter(token) };
    const props = leadDecisionProperties((await c.reader.retrieveDataSource(ds)).properties, n);
    if (!Object.keys(props).length) {
      log.warn("lead decision not copied to Notion: the Leads database has neither Hub property", { project: n.project });
      return { state: "skipped", detail: "the Leads database has no Hub decision or Hub reason: hub install --only notion.lead-pass" };
    }
    await c.writer.setProperties(n.pageId, props);
    log.info("lead decision copied to Notion", { project: n.project, properties: Object.keys(props).length });
    return { state: "synced", properties: Object.keys(props).length };
  } catch (e) {
    const status: unknown = e && typeof e === "object" ? Reflect.get(e, "status") : undefined;
    const code: unknown = e && typeof e === "object" ? Reflect.get(e, "code") : undefined;
    log.warn("lead decision not copied to Notion: the write failed", { project: n.project, status: typeof status === "number" ? status : null, kind: typeof code === "string" ? code : null, error: e instanceof Error ? e.name : "error" });
    return { state: "failed", detail: `${typeof status === "number" ? `HTTP ${status} ` : ""}${typeof code === "string" ? code : e instanceof Error ? e.name : "error"}` };
  }
}
