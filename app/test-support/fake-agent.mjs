#!/usr/bin/env node
// A scripted agent for the e2e of the shared focus (P51 F6, P72): what a dock session does, minus the model and minus Mail.
// It speaks MCP over stdio (newline-delimited JSON-RPC, no SDK).
// - `fake-agent.mjs [text]` ("ответь этому клиенту"): asks `focus` and `draft_show` of `hub mcp`, then revises the focused
//   draft (the focus's subject) through the one writer, `hub record-draft`, with the SAME mailRef.
// - `fake-agent.mjs --knowledge` ("ответь по этой записи"): asks `focus`, takes the pointed row, and reads it with the tool
//   the focus names (`read`: knowledge-mcp `knowledge_get` with its path), never asking for a file name.
// - `fake-agent.mjs --highlight '<refs as JSON>' [note]` ("покажи, где это"): calls `highlight` and prints its answer.
// It never sends: there is no send tool to call and it calls none. Env: HUB_HOME, HUB_PROJECT, HUB_DB, HUB_PROJECTS. Prints one JSON line.
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const hub = fileURLToPath(new URL("../apps/installer/bin/hub.mjs", import.meta.url));
const tsx = fileURLToPath(new URL("../packages/knowledge/node_modules/.bin/tsx", import.meta.url));
const knowledgeBin = fileURLToPath(new URL("../packages/knowledge/src/mcp-bin.ts", import.meta.url));
const mode = process.argv[2] === "--knowledge" ? "knowledge" : process.argv[2] === "--highlight" ? "highlight" : "revise";
const text = mode === "revise" ? (process.argv[2] ?? "I'm well, thanks — and here is the revised answer.") : "";

/** One MCP server over stdio: `rpc`, `tool`, `close`. */
function server(command, args) {
  const child = spawn(command, args, { env: process.env, stdio: ["pipe", "pipe", "inherit"] });
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
  const start = async () => {
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-agent", version: "0" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  };
  return { rpc, tool, start, close: () => child.kill() };
}

const hubMcp = server(process.execPath, [hub, "mcp"]);
const open = [hubMcp];
try {
  await hubMcp.start();
  const tools = (await hubMcp.rpc("tools/list", {})).tools.map((t) => t.name).sort();
  if (mode === "highlight") {
    const r = await hubMcp.tool("highlight", { refs: JSON.parse(process.argv[3] ?? "[]"), ...(process.argv[4] ? { note: process.argv[4] } : {}) });
    console.log(JSON.stringify({ tools, highlight: r }));
    for (const s of open) s.close();
    process.exit(0);
  }
  const focus = await hubMcp.tool("focus");
  if (focus.state !== "fresh") throw new Error(`no fresh focus (state ${focus.state})`);
  if (mode === "knowledge") {
    const it = focus.subject ?? focus.pointed;
    if (!it?.read) throw new Error("the focus names no entry with a read tool");
    if (it.read.server !== "knowledge-mcp") throw new Error(`read by ${it.read.server}, not knowledge-mcp`);
    const km = server(tsx, [knowledgeBin]);
    open.push(km);
    await km.start();
    const got = await km.tool(it.read.tool, it.read.args);
    console.log(JSON.stringify({ tools, focus: { route: focus.route, title: focus.title, ref: it.ref, entry: it.title, read: it.read }, got: { path: got.path, hasBody: typeof got.body === "string" && got.body.length > 0 } }));
  } else {
    // P99: in Mail the subject is the conversation (`client:<id>`); its read is the open draft's `draft_show`, which is "this draft".
    const viaClient = focus.subject?.kind === "client" && focus.subject.read?.tool === "draft_show" ? Number(focus.subject.read.args.draft) : null;
    const subject = focus.subject?.kind === "draft" ? Number(focus.subject.ref.slice("draft:".length)) : viaClient;
    if (!subject) throw new Error("no focused draft");
    const d = await hubMcp.tool("draft_show", { draft: subject });
    const payload = { email: d.client.email, name: d.client.name, subject: d.subject, mailRef: d.mailRef, to: d.to, reason: "Revised on the owner's request in the dock.", excerpt: text, repliesOwed: true, skill: "triage-mail" };
    const out = execFileSync(process.execPath, [hub, "record-draft", "--project", process.env.HUB_PROJECT ?? ""], { input: JSON.stringify(payload), env: { ...process.env, NO_COLOR: "1" }, encoding: "utf8" });
    console.log(JSON.stringify({ tools, focused: subject, recorded: JSON.parse(out) }));
  }
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
  process.exitCode = 1;
} finally {
  for (const s of open) s.close();
}
