import { overviewDto, refreshResponse, type RefreshRequest } from "@hub/contract/overview";
import { read } from "./client";

/** The Overview: one GET of local facts and the cached live numbers, and the explicit read of Mail or Notion for one project. */
export const overviewApi = {
  get: () => read(overviewDto, { method: "GET", path: "/api/overview" }),
  refresh: (body: RefreshRequest) => read(refreshResponse, { method: "POST", path: "/api/overview/refresh", body }),
};
