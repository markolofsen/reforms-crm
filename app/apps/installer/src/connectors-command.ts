import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HubPaths } from "@hub/config/paths";
import { CONNECTOR_KINDS, connectorKindOf, instanceConnectors, KINDS, readConnectorAccounts, writeConnectorAccount, type ConnectorKind } from "@hub/agent/connectors";
import { loadProjects } from "@hub/projects";
import { instanceServer } from "./mcp-servers";

// `hub connectors` (P62): the instance's Google connectors. `list` reads; `add` and `account` are the owner's (a session is denied
// both). A connector is an entry of `config/mcp.json` (the source the owner edits) merged into `.mcp.json` (what sessions read), as
// the install step `files.mcp-json` merges; neither file holds a secret: the OAuth client secret stays with Claude Code.

type Servers = Record<string, Record<string, unknown>>;
const readJson = (f: string): { mcpServers?: Servers } & Record<string, unknown> => {
  try { return JSON.parse(readFileSync(f, "utf8")) as { mcpServers?: Servers }; } catch { return {}; }
};
const writeJson = (f: string, v: unknown): void => {
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(v, null, 2) + "\n");
  renameSync(tmp, f);
};

export interface AddInput { kind: string; name: string; clientId: string; callbackPort?: number; account?: string }

/** Writes the connector's entry into `config/mcp.json` and `.mcp.json`; returns the lines to print. Refuses a name of another kind. */
export function addConnector(paths: HubPaths, i: AddInput): string[] {
  if (!(CONNECTOR_KINDS as readonly string[]).includes(i.kind)) throw new Error(`kind must be one of ${CONNECTOR_KINDS.join(", ")}, got "${i.kind}"`);
  const kind = i.kind as ConnectorKind;
  if (connectorKindOf(i.name) !== kind) throw new Error(`a ${KINDS[kind].label} connector is named ${KINDS[kind].prefix}-<label> (lower case, digits, dashes), got "${i.name}"`);
  if (!/^[0-9]+-[A-Za-z0-9_]+\.apps\.googleusercontent\.com$/.test(i.clientId)) throw new Error("--client-id takes the Google OAuth client id (…apps.googleusercontent.com)");
  if (i.account !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.account)) throw new Error(`--account takes an email address, got "${i.account}"`);
  const spec = { type: "http", url: KINDS[kind].url, oauth: { clientId: i.clientId, ...(i.callbackPort ? { callbackPort: i.callbackPort } : {}) } };
  const source = path.join(paths.configDir, "mcp.json");
  if (!existsSync(source)) throw new Error(`${source} is missing: run \`hub install --only files.config\` first`);
  const src = readJson(source);
  writeJson(source, { ...src, mcpServers: { ...(src.mcpServers ?? {}), [i.name]: spec } });
  const cur = readJson(paths.mcpFile);
  if (existsSync(paths.mcpFile) && !existsSync(`${paths.mcpFile}.bak`)) copyFileSync(paths.mcpFile, `${paths.mcpFile}.bak`);
  writeJson(paths.mcpFile, { ...cur, mcpServers: { ...(cur.mcpServers ?? {}), [i.name]: instanceServer(spec, paths) } });
  if (i.account) writeConnectorAccount(paths, i.name, i.account, "stated");
  return [
    `added ${i.name} (${KINDS[kind].label}, ${KINDS[kind].url}) to config/mcp.json and .mcp.json`,
    `next: attach it to a project (say "настрой проект <slug>", or a ${kind}.connector row in its project.md), run \`hub agent <slug> --prepare\`, then in that project's Claude Code session type /mcp and sign in with ${i.account ?? "the Google account it is for"}`,
  ];
}

/** `hub connectors account <name> <address>`: the owner states the account a connector is signed in to (a session's read replaces it). */
export function stateAccount(paths: HubPaths, name: string, address: string): string {
  if (!instanceConnectors(paths).some((c) => c.name === name)) throw new Error(`no connector "${name}" in the instance's MCP config (hub connectors list)`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error(`expected an email address, got "${address}"`);
  writeConnectorAccount(paths, name, address, "stated");
  return `${name}: ${address.trim().toLowerCase()} (stated)`;
}

/** `hub connectors list`: one line each: name, service, account and how it is known, the projects that attach it. */
export function listConnectors(paths: HubPaths): string {
  const accounts = readConnectorAccounts(paths);
  const projects = loadProjects(paths.projects);
  const lines = instanceConnectors(paths).map((c) => {
    const users = projects.filter((p) => [...p.parsed.config.calendar.connector, ...p.parsed.config.drive.connector].includes(c.name)).map((p) => p.slug);
    const a = accounts[c.name];
    return [c.name, KINDS[c.kind].label, a ? `${a.account} (${a.how} ${a.at.slice(0, 10)})` : "account not known", users.length ? `attached to ${users.join(", ")}` : "attached to no project", c.endpointOk ? "" : `NOT Google's ${KINDS[c.kind].label} endpoint`].filter(Boolean).join("  ");
  });
  return lines.length ? lines.join("\n") : "no connectors: `hub connectors add calendar gcal-<label> --client-id <id> --account <address>` (@docs/core/26-capabilities.md)";
}
