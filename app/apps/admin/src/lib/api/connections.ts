import { connectionDto, connectionsDto } from "@hub/contract/connections";
import type { SetSecretBody } from "@hub/contract/requests";
import { read } from "./client";

/** The Connections panel: one GET of files, settings and cached test results (no network), and one read-only test per connection, a write-only key and a remove (decision 0020). */
export const connectionsApi = {
  list: () => read(connectionsDto, { method: "GET", path: "/api/connections" }),
  test: (id: string) => read(connectionDto, { method: "POST", path: `/api/connections/${encodeURIComponent(id)}/test` }),
  /** The one call that carries a key, and only toward the server. The reply is the row, which has no field for a value. */
  setSecret: (id: string, body: SetSecretBody) => read(connectionDto, { method: "PUT", path: `/api/connections/${encodeURIComponent(id)}/secret`, body }),
  remove: (id: string) => read(connectionDto, { method: "POST", path: `/api/connections/${encodeURIComponent(id)}/remove` }),
};
