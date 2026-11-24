import { checkClientMap, MAP_CLASSES, MAP_LIMITS } from "@hub/diagram/map";
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

const MAP_DESCRIPTION = `The WHOLE map, redrawn from what you read now: never the old text with a node added. Mermaid "flowchart TD": the root is the client (company); under it their goals or problems (at most ${MAP_LIMITS.goals} open); under each, sub-questions, at most ${MAP_LIMITS.depth} levels below the client; each leaf is what we did or offered, with a state class (${MAP_CLASSES.join(", ")}) as :::open or "class id done". Resolved branches stay, marked done. Ids stable across redraws (p1, p1a, p1a1). At most ${MAP_LIMITS.nodes} nodes, labels at most ${MAP_LIMITS.words} words, edge labels only when the link is not "part of" (-->|offered|). No address, phone or third party's price; no classDef, style or click.`;

export const clientMapTool = defineTool({
  name: "client_map",
  title: "Redraw a client's map",
  description: "After you wrote a draft for a client (mail or messenger): replace the client's map with a new whole Mermaid picture of their goals, what is open and what we did. Read the current map first with client_show. The hub checks it and refuses with the line to fix (the old map stays); it stores every version and copies the map to the client's Notion page. Sends nothing.",
  input: z
    .object({
      client: z.number().int().positive().optional().describe("the client's id (client_show, focus ref client:<id>, a chat's client)"),
      email: z.string().trim().max(320).email().optional().describe("or the client's address"),
      map: z.string().min(1).max(MAP_LIMITS.chars).describe(MAP_DESCRIPTION),
    })
    .strict(),
  output: z.object({ ok: z.literal(true), project: z.string(), clientId: z.number(), updatedAt: z.string(), versions: z.number(), unchanged: z.boolean(), nodes: z.number(), notion: z.string() }),
  effect: "draft",
  refusals: ["not_found", "map_invalid", "unavailable", "busy", "record_failed"],
  handler: async (ctx, input) => {
    const slug = ctx.project();
    const env = ctx.env.records;
    if (!env) throw new ToolError("unavailable", "This hub MCP server cannot record (no database to write).");
    const cid = input.client ?? (input.email ? await ctx.repos.clients.idByEmail(slug, input.email) : undefined);
    if (input.client === undefined && input.email === undefined) throw new ToolError("invalid", "Give the client's id or email.");
    if (cid === undefined) throw new ToolError("not_found", `No client ${input.email ?? ""} in project ${slug}: a map is drawn for a client the hub recorded (after a draft).`);
    const check = checkClientMap(input.map);
    if (!check.ok) throw new ToolError("map_invalid", `${check.line === null ? "The map" : `Line ${check.line}`}: ${check.error}. The old map stays.`);
    let saved;
    let handle: ReturnType<typeof openDb> | undefined;
    try {
      handle = openDb(env.dbPath);
      saved = await createRepos(handle.db).clientMaps.save(slug, cid, input.map, ctx.now());
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
    return { ok: true as const, project: slug, clientId: cid, updatedAt: saved.updatedAt, versions: saved.versions, unchanged: saved.unchanged, nodes: check.nodes.length, notion };
  },
});
