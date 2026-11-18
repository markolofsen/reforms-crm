import { overviewDto } from "@hub/contract/overview";
import { read } from "./client";

/** The Overview (contract v5): one GET of local facts, one row per project with its status. No live read exists. */
export const overviewApi = {
  get: () => read(overviewDto, { method: "GET", path: "/api/overview" }),
};
