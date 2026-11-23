import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createRepos, openDb, openDbReadOnly, type Repos } from "@hub/db";
import { CONTEXT_BLOCK_FROM } from "@hub/projects/context";
import { projectStore } from "@hub/projects/store";
import { readAllowList, testRecipientsOf } from "@hub/projects/guard";
import { setSendPolicy } from "@hub/projects/send-policy";
import { FakeDraftWriter } from "@hub/mail-app/writer/fake";
import { ownerWordsFound } from "../messenger/owner-word";
import type { HubMcpEnv, NotionClientCheck, RevisionRecord, VersionRecord } from "../mcp/ports";
import { createHubMcpServer } from "../mcp/server";

// `@hub/agent/testing` (P129 verdict 10, A7): one fake set for every test of `hub mcp`; the replay runner is `./replay.ts`.
// Test-only: no `src` file imports it (architecture rule 3b, fakes behind their own subpath). `fakePorts` builds the ports
// `stdio.ts` builds, on fakes: `FakeDraftWriter` for Mail, a table for the Notion Clients check, temp focus and pointer files,
// a fixture project under a temp instance, the send policy and allow-list, and an in-memory session log of owner prompts
// (verdict 7). The tools read the database read-only and record on short write connections, exactly as `hub mcp` does.

/** The fixture projects (invented clients) of `@hub/projects`' tests. */
export const FIXTURE_PROJECTS = path.resolve(import.meta.dirname, "..", "..", "..", "projects", "test", "fixtures", "projects");

/** The clock of flows that are not about the context block: the day before it became required. */
export const BEFORE_CONTEXT_BLOCK = new Date(Date.parse(CONTEXT_BLOCK_FROM) - 86_400_000 + 12 * 3_600_000);

export interface FakePortsOptions {
  /** The bound slug (default `acme`). */
  slug?: string;
  /** The fixture project copied to `projects/<slug>` (default `acme-travel`). */
  fixture?: string;
  /** `any` (default) or test mode with these addresses as the instance's allow-list. */
  recipients?: "any" | { test: string[] };
  /** The Notion Clients check by address; an address not listed is `not_client`. */
  notion?: Record<string, NotionClientCheck>;
  now?: Date;
  /** Anything else of the env, over the fakes. */
  env?: Partial<HubMcpEnv>;
}

export interface FakePorts {
  slug: string;
  dir: string;
  dbPath: string;
  projectsDir: string;
  policyDir: string;
  configFile: string;
  /** The fake Mail: put `headers`, `inbound` and `contents` there before a call; read `drafts` after. */
  mail: FakeDraftWriter;
  env: HubMcpEnv;
  /** The read-only repositories the tools get. */
  repos: Repos;
  /** A short write connection, for seeding rows and reading them back. */
  write: <T>(fn: (r: Repos) => Promise<T>) => Promise<T>;
  /** One owner prompt in this project's session log (what `owner_request` is verified against). */
  prompt: (text: string, at?: Date) => void;
  close: () => void;
}

export function fakePorts(o: FakePortsOptions = {}): FakePorts {
  const slug = o.slug ?? "acme";
  const now = o.now ?? BEFORE_CONTEXT_BLOCK;
  const dir = mkdtempSync(path.join(tmpdir(), "hub-fake-ports-"));
  const projectsDir = path.join(dir, "projects");
  const policyDir = path.join(dir, "state", "projects");
  const configFile = path.join(dir, "config", "config.json");
  const dbPath = path.join(dir, "data", "app.db");
  cpSync(path.join(FIXTURE_PROJECTS, o.fixture ?? "acme-travel"), path.join(projectsDir, slug), { recursive: true });
  mkdirSync(path.dirname(configFile), { recursive: true });
  const test = o.recipients && o.recipients !== "any" ? o.recipients.test : null;
  writeFileSync(configFile, JSON.stringify({ allow_list: test ?? [] }));
  const kind = projectStore({ projects: projectsDir }).config(slug).kind;
  setSendPolicy(policyDir, slug, kind, { "draft.recipients": test ? "test" : "any" }, "test", now);
  openDb(dbPath).close(); // migrated once; the tools then read it read-only
  const ro = openDbReadOnly(dbPath);
  const repos = createRepos(ro.db);
  const write = async <T>(fn: (r: Repos) => Promise<T>): Promise<T> => {
    const w = openDb(dbPath);
    try {
      return await fn(createRepos(w.db));
    } finally {
      w.close();
    }
  };
  const config = () => projectStore({ projects: projectsDir, stateProjects: policyDir }).config(slug);
  const prompts: Array<{ ts: string; session: string; kind: "prompt"; data: Record<string, unknown> }> = [];
  const mail = new FakeDraftWriter();
  const env: HubMcpEnv = {
    hubProject: slug,
    focusFile: path.join(dir, "state", "focus.json"),
    pointerFile: path.join(dir, "state", "pointer.json"),
    pointerWritten: () => {},
    now: () => now,
    drafts: mail,
    projectMail: () => {
      const c = config();
      return { accounts: c.mail.accounts, sender: c.mail.sender, identity: { addresses: c.mail.addresses, domains: c.mail.domains, signoff: c.signoff, brands: c.brands, languages: c.languages }, messengers: c.messengers };
    },
    projectConfig: () => config(),
    mailWritten: () => {},
    recordRevision: (s: string, id: number, r: RevisionRecord) => write((w) => w.drafts.revised(s, id, r)),
    recordVersion: (s: string, v: VersionRecord) =>
      write(async (w) => {
        await w.mailVersions.add({ project: s, mailRef: v.mailRef, draftId: v.draftId, account: v.account, mailId: v.mailId, messageId: v.messageId, hash: v.hash, source: "agent", signatureFallback: v.signatureFallback });
        await w.mailVersions.markTrashed(v.trashed);
      }),
    withRepos: write,
    clientInNotion: async (_s: string, email: string) => o.notion?.[email.trim().toLowerCase()] ?? { state: "not_client" },
    testRecipients: () => testRecipientsOf(config(), readAllowList(configFile)),
    records: { dbPath, projectsDir, policyDir, configFile, ledgerRoot: dir, now: () => now },
    ownerWords: (_s: string, words: string) => ownerWordsFound({ events: prompts, words, now }).ok,
    ...o.env,
  };
  return {
    slug,
    dir,
    dbPath,
    projectsDir,
    policyDir,
    configFile,
    mail,
    env,
    repos,
    write,
    prompt: (text, at = new Date(now.getTime() - 60_000)) => void prompts.push({ ts: at.toISOString(), session: "replay", kind: "prompt", data: { text } }),
    close: () => {
      ro.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface Connected {
  client: Client;
  /** One tool call: the parsed JSON of its reply (a refusal's `error`, `retry` and `next` included) and whether it refused. */
  call: (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; json: Record<string, unknown> }>;
  /** The tool names the server lists. */
  tools: () => Promise<string[]>;
}

/** `hub mcp` on these ports, over an in-memory transport. */
export async function connect(p: Pick<FakePorts, "repos" | "env">): Promise<Connected> {
  const server = createHubMcpServer(p.repos, p.env);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "hub-test", version: "0" });
  await client.connect(a);
  const call: Connected["call"] = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { error: "invalid_input", message: text }; // the SDK's own refusal of the input schema is plain text
    }
    return { isError: res.isError === true, json };
  };
  return { client, call, tools: async () => (await client.listTools()).tools.map((t) => t.name).sort() };
}
