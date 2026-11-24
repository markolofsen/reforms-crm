import { checkClientMap, diffMaps, MAP_CLASSES, MAP_LIMITS, whyNeeded } from "@hub/diagram/map";
import { createRepos, openDb } from "@hub/db";
import { z } from "zod";
import { defineTool } from "../define";
import { ToolError } from "../result";

// P135 K3 (verdicts 3 to 6): the agent redraws a client's map after it wrote a draft (Mail or a messenger). The hub checks the
// whole text (`@hub/diagram/map`: valid Mermaid of the subset, the shape caps), keeps the old map on a refusal, stores the new
// one with its version, then copies it to the client's Notion page when the instance can. Writing a map sends nothing.
//
// Deviation from verdict 3 ("client_record's new map field"): `client_record` records a client handled WITHOUT a draft (it writes
// an Inbox row with that action), and a drafted client is recorded by `draft_write`; a map after a draft is neither, so it is a
// tool of its own that both channels call, read back by `client_show`.
//
// P136 Q2 (verdicts 1 to 4): every node below the client names its source (`%% src`), the tool answers the diff against the
// version before (added, removed, renamed, state changes), and a node removed or renamed without a reason in `why` is refused
// (`map_why_missing`; the old map stays). Sources and reasons are stored with the version. The redraw is due after a draft, an
// owner-sent reply the agent sees, or an inbound message with a new fact; never for spam, "thanks" or "ok".

const ID = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

const MAP_DESCRIPTION = `The WHOLE map, redrawn from scratch from client_show and what you read now: never the old text with a node added. Mermaid "flowchart TD". Checklist: the root is the client (company); level 1 is THEIR outcomes in their words, not our tasks (at most ${MAP_LIMITS.goals} open); under each, sub-questions, at most ${MAP_LIMITS.depth} levels below the client; every leaf a concrete action or answer with a state class (${MAP_CLASSES.join(", ")}) as :::open or "class id done"; a waiting leaf names who is awaited ("Bank's answer awaited"); branches done for 30+ days collapse into one "Done" node. Every node below the client has a source on its own line: %% src <id>: <Message-ID or YYYY-MM-DD channel>[, more]. Ids stable across redraws (p1, p1a, p1a1). At most ${MAP_LIMITS.nodes} nodes, labels at most ${MAP_LIMITS.words} words, edge labels only when the link is not "part of" (-->|offered|). No address, phone or third party's price; no classDef, style or click.`;

const diffOut = z.object({
  added: z.array(z.object({ id: z.string(), label: z.string(), state: z.enum(MAP_CLASSES).nullable() })),
  removed: z.array(z.object({ id: z.string(), label: z.string() })),
  renamed: z.array(z.object({ id: z.string(), from: z.string(), to: z.string() })),
  states: z.array(z.object({ id: z.string(), label: z.string(), from: z.enum(MAP_CLASSES).nullable(), to: z.enum(MAP_CLASSES).nullable() })),
});

export const clientMapTool = defineTool({
  name: "client_map",
  title: "Redraw a client's map",
  description: "Redraw a client's whole map (their goals, what is open, what we did) after you wrote a draft, after an owner-sent reply you see in Mail or a chat, or after their message brings a new fact (a decision, price, date, refusal); never for spam, thanks or ok. Read it first with client_show. Every node names its source; pass why for each node you remove or rename. Answers the diff against the previous version; a refusal names the line to fix and the old map stays. Copies it to the client's Notion page. Sends nothing.",
  input: z
    .object({
      client: z.number().int().positive().optional().describe("the client's id (client_show, focus ref client:<id>, a chat's client)"),
      email: z.string().trim().max(320).email().optional().describe("or the client's address"),
      map: z.string().min(1).max(MAP_LIMITS.chars).describe(MAP_DESCRIPTION),
      why: z
        .record(z.string().regex(ID), z.string().trim().min(3).max(200))
        .optional()
        .describe('node id -> one short reason, for every node of the current map you remove or rename ({"p2a": "merged into p2b", "p1": "they renamed the goal"}); a removal or rename without one is refused'),
    })
    .strict(),
  output: z.object({ ok: z.literal(true), project: z.string(), clientId: z.number(), updatedAt: z.string(), versions: z.number(), unchanged: z.boolean(), nodes: z.number(), diff: diffOut, notion: z.string() }),
  effect: "draft",
  refusals: ["not_found", "map_invalid", "map_why_missing", "unavailable", "busy", "record_failed"],
  handler: async (ctx, input) => {
    const slug = ctx.project();
    const env = ctx.env.records;
    if (!env) throw new ToolError("unavailable", "This hub MCP server cannot record (no database to write).");
    const cid = input.client ?? (input.email ? await ctx.repos.clients.idByEmail(slug, input.email) : undefined);
    if (input.client === undefined && input.email === undefined) throw new ToolError("invalid", "Give the client's id or email.");
    if (cid === undefined) throw new ToolError("not_found", `No client ${input.email ?? ""} in project ${slug}: a map is drawn for a client the hub recorded (after a draft).`);
    const check = checkClientMap(input.map);
    if (!check.ok) throw new ToolError("map_invalid", `${check.line === null ? "The map" : `Line ${check.line}`}: ${check.error}. The old map stays.`);
    const current = await ctx.repos.clientMaps.get(slug, cid);
    if (!current) throw new ToolError("not_found", `No client ${cid} in project ${slug}.`);
    const before = current.source ? checkClientMap(current.source, { sources: "optional" }) : null;
    const diff = diffMaps(before?.ok ? before : null, check);
    const need = whyNeeded(diff);
    const missing = need.filter((id) => !input.why?.[id]?.trim());
    if (missing.length) {
      const what = (id: string) => (diff.removed.some((r) => r.id === id) ? `${id} (removed)` : `${id} (renamed)`);
      throw new ToolError("map_why_missing", `${missing.slice(0, 6).map(what).join(", ")} ${missing.length === 1 ? "has" : "have"} no reason: pass why {"${missing[0]}": "<why>"} for each. The old map stays.`);
    }
    const reasons = Object.fromEntries(need.map((id) => [id, input.why?.[id]?.trim() ?? ""]));
    let saved;
    let handle: ReturnType<typeof openDb> | undefined;
    try {
      handle = openDb(env.dbPath);
      saved = await createRepos(handle.db).clientMaps.save(slug, cid, input.map, ctx.now(), { sources: check.sources, reasons });
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? e.code : undefined;
      if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") throw new ToolError("busy", "the database is busy: try again in a moment");
      throw new ToolError("record_failed", e instanceof Error ? e.message : String(e));
    } finally {
      handle?.close();
    }
    if (!saved) throw new ToolError("not_found", `No client ${cid} in project ${slug}.`);
    let notion = "unchanged";
    if (!saved.unchanged) {
      const sync = ctx.env.syncClientMap;
      notion = sync ? (await sync(slug, { email: saved.email, source: input.map, at: saved.updatedAt }).catch(() => ({ state: "failed" }))).state : "off";
    }
    return { ok: true as const, project: slug, clientId: cid, updatedAt: saved.updatedAt, versions: saved.versions, unchanged: saved.unchanged, nodes: check.nodes.length, diff, notion };
  },
});
