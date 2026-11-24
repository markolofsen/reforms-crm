import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HubPaths } from "@hub/config/paths";

// P112 S3: which project a `hub mcp` process serves. `HUB_PROJECT` is a hint; the authority is a capability the launcher issues
// with it: an HMAC of the slug under a key in `state/secrets` (every session is denied that folder, as it is the agent-send token).
// `hub agent` (and, for decision 0048, the server's autopilot runner) writes both into the session's MCP config for the `hub`
// server; `hub mcp` checks them once at start and keeps the slug for its whole life (immutable). A slug without its capability,
// or with another project's, binds nothing: every tool then refuses as unbound. The deny rules keep other projects' session
// files, where their capabilities are written, out of a session's reach.

export const PROJECT_CAPABILITY_ENV = "HUB_PROJECT_CAPABILITY";
export const PROJECT_BINDING_KEY_FILE = "project-binding-key";

const keyFile = (paths: Pick<HubPaths, "secrets">): string => join(paths.secrets, PROJECT_BINDING_KEY_FILE);

function readKey(paths: Pick<HubPaths, "secrets">): string | null {
  const f = keyFile(paths);
  if (!existsSync(f)) return null;
  const k = readFileSync(f, "utf8").trim();
  return k || null;
}

/** The launcher's: the instance's binding key, made once (600) when the file is missing or empty. */
function ensureKey(paths: Pick<HubPaths, "secrets">): string {
  const old = readKey(paths);
  if (old) return old;
  mkdirSync(paths.secrets, { recursive: true, mode: 0o700 });
  const key = randomBytes(32).toString("hex");
  writeFileSync(keyFile(paths), `${key}\n`, { mode: 0o600 });
  chmodSync(keyFile(paths), 0o600);
  return key;
}

const sign = (key: string, slug: string): string => createHmac("sha256", key).update(`hub-project:${slug}`).digest("hex");

/** The capability of one project, for its session's `hub` server (the launcher's and the autopilot runner's only). */
export function projectCapability(paths: Pick<HubPaths, "secrets">, slug: string): string {
  return sign(ensureKey(paths), slug);
}

export type ProjectBinding = { project: string; refusal?: undefined } | { project?: undefined; refusal: string | null };

/**
 * `hub mcp`'s check at start: the slug `HUB_PROJECT` names, only when its capability matches. No slug: unbound, no refusal (the
 * project-setup session). A slug without a valid capability: unbound, with the sentence the tools and the ops line give.
 */
export function bindProject(paths: Pick<HubPaths, "secrets">, env: NodeJS.ProcessEnv): ProjectBinding {
  const slug = env.HUB_PROJECT?.trim();
  if (!slug) return { refusal: null };
  const presented = env[PROJECT_CAPABILITY_ENV]?.trim();
  const key = readKey(paths);
  if (!presented || !key) return { refusal: `HUB_PROJECT=${slug} came without the launcher's project capability: start the session with \`hub agent ${slug}\`` };
  const a = Buffer.from(presented);
  const b = Buffer.from(sign(key, slug));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { refusal: `the project capability does not match HUB_PROJECT=${slug}: start the session with \`hub agent ${slug}\`` };
  return { project: slug };
}
