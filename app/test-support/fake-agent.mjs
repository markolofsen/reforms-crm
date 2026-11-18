#!/usr/bin/env node
// A scripted agent for the e2e of the shared focus (P51 F6): what a dock session does on "ответь этому клиенту", minus the
// model and minus Mail. It speaks MCP over stdio to `hub mcp` (newline-delimited JSON-RPC, no SDK), asks `focus` and
// `draft_show`, then revises the focused draft through the one writer, `hub record-draft`, with the SAME mailRef. It never
// sends: there is no send tool to call and it calls none. Env: HUB_HOME, HUB_PROJECT, HUB_DB, HUB_PROJECTS. Prints one JSON line.
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const hub = fileURLToPath(new URL("../apps/installer/bin/hub.mjs", import.meta.url));
const text = process.argv[2] ?? "I'm well, thanks — and here is the revised answer.";

const child = spawn(process.execPath, [hub, "mcp"], { env: process.env, stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const waiting = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  }
});
let next = 1;
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = next++;
    const t = setTimeout(() => reject(new Error(`${method}: no answer`)), 20_000);
    waiting.set(id, (m) => {
      clearTimeout(t);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
const tool = async (name, args = {}) => {
  const r = await rpc("tools/call", { name, arguments: args });
  const body = JSON.parse(r.content[0].text);
  if (r.isError) throw new Error(`${name}: ${body.message}`);
  return body;
};

try {
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-agent", version: "0" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tools = (await rpc("tools/list", {})).tools.map((t) => t.name).sort();
  const focus = await tool("focus");
  if (focus.state !== "fresh" || !focus.draft) throw new Error(`no fresh focused draft (state ${focus.state})`);
  const d = await tool("draft_show", { id: focus.draft.id });
  const payload = { email: d.client.email, name: d.client.name, subject: d.subject, mailRef: d.mailRef, to: d.to, reason: "Revised on the owner's request in the dock.", excerpt: text, repliesOwed: true, skill: "triage-mail" };
  const out = execFileSync(process.execPath, [hub, "record-draft", "--project", process.env.HUB_PROJECT ?? ""], { input: JSON.stringify(payload), env: { ...process.env, NO_COLOR: "1" }, encoding: "utf8" });
  console.log(JSON.stringify({ tools, focused: focus.draft.id, recorded: JSON.parse(out) }));
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
  process.exitCode = 1;
} finally {
  child.kill();
}
