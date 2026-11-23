import { agentToolsDto } from "@hub/contract/agent-tools";
import { autostartDto } from "@hub/contract/autostart";
import { connectionDto, connectionsDto } from "@hub/contract/connections";
import type { SetSecretBody } from "@hub/contract/requests";
import { getAgentTools, getAutostart, listConnections, refreshAgentTools, removeConnectionSecret, setAutostart, setConnectionSecret, testConnection } from "@hub/api";
import { readGenerated } from "./client";

/**
 * Settings ▸ Connections and ▸ Mail (P70): one GET of files, settings, cached test results and Apple Mail's account list (no network), and for
 * the Notion token and the Telegram bot one read-only test, a write-only key and a remove (decisions 0020, 0026: mail has no key).
 * Its second block, Agent tools (P49 section 5B), reads the last result of the server's checks per project and reruns them (about 10 s).
 */
export const connectionsApi = {
  list: () => readGenerated(listConnections(), connectionsDto),
  test: (id: string) => readGenerated(testConnection(id), connectionDto),
  /** The one call that carries a key, and only toward the server. The reply is the row, which has no field for a value. */
  setSecret: (id: string, body: SetSecretBody) => readGenerated(setConnectionSecret(id, body), connectionDto),
  remove: (id: string) => readGenerated(removeConnectionSecret(id), connectionDto),
  agentTools: (slug: string) => readGenerated(getAgentTools(slug), agentToolsDto),
  /** P67: whether this Mac starts the Hub at login, and the switch (the server runs only `launchctl enable|disable`). */
  autostart: () => readGenerated(getAutostart(), autostartDto),
  setAutostart: (enabled: boolean) => readGenerated(setAutostart({ enabled }), autostartDto),
  refreshAgentTools: (slug: string) => readGenerated(refreshAgentTools(slug), agentToolsDto),
};
