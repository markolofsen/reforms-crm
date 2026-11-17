import { connectionDto, connectionsDto } from "@hub/contract/connections";
import { read } from "./client";

/** The Connections panel: one GET of files, settings and cached test results (no network), and one read-only test per connection. */
export const connectionsApi = {
  list: () => read(connectionsDto, { method: "GET", path: "/api/connections" }),
  test: (id: string) => read(connectionDto, { method: "POST", path: `/api/connections/${encodeURIComponent(id)}/test` }),
};
