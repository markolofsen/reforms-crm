import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_SEND_HEADER } from "@hub/agent/send-token";
import { agentUnlinkedDto, autolinkStateDto } from "@hub/contract/messengers";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import type { UserDialog } from "@hub/messengers";
import { startAutolink, type Autolink, type AutolinkAdapter } from "../../../src/messengers/autolink/autolink";
import { startClientDirectory, type ClientDirectory } from "../../../src/clients/directory";
import { autolinkRoutes } from "../../../src/messengers/autolink/routes";

// P128 X5 ("sort the chats"): the agent reads the unlinked chats and proposes hides through its token; the proposals live in
// memory beside the chats, the owner's state shows them, and nothing is hidden until his Hide. No Telegram, Notion or network.

const ADMIN = 5173;
const TOKEN = "t".repeat(64);
const ADMIN_HEADERS = { origin: `http://127.0.0.1:${ADMIN}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const AGENT_HEADERS = { "content-type": "application/json", [AGENT_SEND_HEADER]: TOKEN };
const BASE = "http://127.0.0.1:4317";
const NOW = new Date("2026-11-20T12:00:00.000Z");

let handle: DbHandle;
let repos: Repos;
let dir: string;
let directory: ClientDirectory;
let al: Autolink;
let dialogs: UserDialog[];

const adapter = { dialogs: async () => dialogs } as unknown as AutolinkAdapter;
const routes = (token: string | null) => autolinkRoutes({ repos, autolink: { project: null, autolink: al, directory, stop: () => undefined }, adminPort: ADMIN, ...(token ? { agentToken: token } : {}) });
// `token: null` starts the routes without an agent token (a default parameter would turn `undefined` back into TOKEN).
const post = (path: string, body: unknown, headers: Record<string, string>, token: string | null = TOKEN) =>
  routes(token).request(`${BASE}/api/projects/p/messengers/autolink/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const state = async () => autolinkStateDto.parse(await (await post("state", {}, ADMIN_HEADERS)).json());

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  dir = mkdtempSync(join(tmpdir(), "hub-autolink-proposals-"));
  directory = startClientDirectory({ dataSourceId: null, tokenFile: "notion-token", auto: false });
  dialogs = [
    { chatId: "3001", title: "Pizza Place", username: null, phone: null, last: { at: NOW.toISOString(), inbound: true } },
    { chatId: "3002", title: "Maybe Mia", username: null, phone: null, last: { at: NOW.toISOString(), inbound: true } },
  ];
  al = startAutolink({ repos, project: "p", directory, enabled: async () => true, adapterOf: () => adapter, accounts: () => [{ channel: "telegram_user", account: "42" }], keyFile: join(dir, "autolink-key"), now: () => NOW });
  await al.scan("telegram_user", "42");
  await al.idle();
});
afterEach(() => {
  directory.stop();
  handle.close();
});

describe("the agent's proposed hides", () => {
  it("refuses a call without the token, and the admin's Origin is not the token", async () => {
    expect((await post("agent-unlinked", {}, ADMIN_HEADERS)).status).toBe(403);
    expect((await post("agent-proposals", { items: [{ channel: "telegram_user", chatId: "3001", reason: "A restaurant." }] }, AGENT_HEADERS, null)).status).toBe(403);
  });

  it("lists the unlinked chats by identity (no text), keeps a proposal per known chat, and shows them in the owner's state", async () => {
    const read = agentUnlinkedDto.parse(await (await post("agent-unlinked", {}, AGENT_HEADERS)).json());
    expect(read.chats.map((c) => c.title).sort()).toEqual(["Maybe Mia", "Pizza Place"]);
    const r = await post("agent-proposals", { items: [{ channel: "telegram_user", chatId: "3001", reason: "A restaurant's order chat." }, { channel: "telegram_user", chatId: "9999", reason: "Unknown." }] }, AGENT_HEADERS);
    expect(await r.json()).toEqual({ ok: true, kept: 1, skipped: 1 });
    const st = await state();
    expect(st.proposals).toEqual([{ channel: "telegram_user", account: "42", chatId: "3001", title: "Pizza Place", reason: "A restaurant's order chat.", at: NOW.toISOString() }]);
    // Proposing hid nothing.
    expect(st.hidden).toEqual([]);
    expect(st.unlinked).toHaveLength(2);
  });

  it("drops a proposal on the owner's Keep and on his Hide", async () => {
    await post("agent-proposals", { items: [{ channel: "telegram_user", chatId: "3001", reason: "A shop." }, { channel: "telegram_user", chatId: "3002", reason: "Spam." }] }, AGENT_HEADERS);
    expect((await post("proposals/drop", { items: [{ channel: "telegram_user", chatId: "3002" }] }, ADMIN_HEADERS)).status).toBe(200);
    expect((await post("hide", { channel: "telegram_user", chatId: "3001" }, ADMIN_HEADERS)).status).toBe(200);
    expect((await state()).proposals).toEqual([]);
  });
});
