import { agentToolsDto } from "@hub/contract/agent-tools";
import { connectionDto, connectionsDto } from "@hub/contract/connections";
import type { SetSecretBody } from "@hub/contract/requests";
import { read } from "./client";

/**
 * The Connections page: one GET of files, settings, cached test results and Apple Mail's account list (no network), and for
 * the Notion token and the Telegram bot one read-only test, a write-only key and a remove (decisions 0020, 0026: mail has no key).
 * Its second block, Agent tools (P49 section 5B), reads the last result of the server's checks per project and reruns them (about 10 s).
 */
export const connectionsApi = {
  list: () => read(connectionsDto, { method: "GET", path: "/api/connections" }),
  test: (id: string) => read(connectionDto, { method: "POST", path: `/api/connections/${encodeURIComponent(id)}/test` }),
  /** The one call that carries a key, and only toward the server. The reply is the row, which has no field for a value. */
  setSecret: (id: string, body: SetSecretBody) => read(connectionDto, { method: "PUT", path: `/api/connections/${encodeURIComponent(id)}/secret`, body }),
  remove: (id: string) => read(connectionDto, { method: "POST", path: `/api/connections/${encodeURIComponent(id)}/remove` }),
  agentTools: (slug: string) => read(agentToolsDto, { method: "GET", path: `/api/projects/${encodeURIComponent(slug)}/agent-tools` }),
  refreshAgentTools: (slug: string) => read(agentToolsDto, { method: "POST", path: `/api/projects/${encodeURIComponent(slug)}/agent-tools/refresh` }),
};
