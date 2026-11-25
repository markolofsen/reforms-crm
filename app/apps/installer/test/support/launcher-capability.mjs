// Test only (e2e): the project capability `hub agent` writes into a session's MCP config for the `hub` server (P112 S3), for a
// scripted session that is its own launcher (`test-support/fake-agent.mjs`). It lives here because tsx resolves from this package.
import { register } from "tsx/esm/api";

register();
const { hubPaths } = await import("@hub/config/paths");
const { projectCapability, PROJECT_CAPABILITY_ENV } = await import("@hub/agent/mcp-binding");

/** `{ HUB_PROJECT_CAPABILITY: <hmac> }` for `env.HUB_PROJECT`, or `{}` when it names no project (an unbound session). */
export function launcherCapability(env = process.env) {
  const slug = env.HUB_PROJECT?.trim();
  return slug ? { [PROJECT_CAPABILITY_ENV]: projectCapability(hubPaths({ env }), slug) } : {};
}
