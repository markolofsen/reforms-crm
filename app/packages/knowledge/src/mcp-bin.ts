#!/usr/bin/env tsx
// `knowledge-mcp`: stdio server. Env: HUB_PROJECT (required in a run), HUB_DB (default <app>/data/app.db).
// Nothing may be written to stdout except the protocol.
import { createRepos, openDb } from "@hub/db";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createKnowledgeServer } from "./mcp.js";

const handle = openDb();
const server = createKnowledgeServer(createRepos(handle.db), { hubProject: process.env.HUB_PROJECT });
process.on("SIGINT", () => handle.close());
await server.connect(new StdioServerTransport());
