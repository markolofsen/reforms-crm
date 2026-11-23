import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HubPaths } from "@hub/config/paths";

// The agent send route answers only `hub mcp` (decision 0046, `@rules/approval-and-capabilities.md` rule 9): a random token in
// `state/secrets/agent-send-token`, made by the server at start, read by `hub mcp` per call. Every session is denied the secrets
// folder (Read, Edit and Bash in every mode, the Codex profile `none`), so the agent itself cannot present it.

export const AGENT_SEND_TOKEN_FILE = "agent-send-token";
/** The header `hub mcp` sends it in. */
export const AGENT_SEND_HEADER = "x-hub-agent-token";

export const agentSendTokenFile = (paths: Pick<HubPaths, "secrets">): string => join(paths.secrets, AGENT_SEND_TOKEN_FILE);

/** The server's: the token, made once (600) when the file is missing or empty. */
export function ensureAgentSendToken(paths: Pick<HubPaths, "secrets">): string {
  const file = agentSendTokenFile(paths);
  const old = readAgentSendToken(paths);
  if (old) return old;
  mkdirSync(paths.secrets, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

/** `hub mcp`'s: the token, or null when the server has not made one yet. */
export function readAgentSendToken(paths: Pick<HubPaths, "secrets">): string | null {
  const file = agentSendTokenFile(paths);
  if (!existsSync(file)) return null;
  const t = readFileSync(file, "utf8").trim();
  return t || null;
}

/** Constant-time comparison of a presented token with the server's. */
export function tokenMatches(presented: string | undefined, token: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
