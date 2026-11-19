import { overviewDto } from "@hub/contract/overview";
import { schemeDto } from "@hub/contract/scheme";
import { read } from "./client";

/** The Overview (contract v5): one GET of local facts, one row per project with its status. No live read exists. */
export const overviewApi = {
  get: () => read(overviewDto, { method: "GET", path: "/api/overview" }),
  /** The Hub's parts and how each stands (P63 O1): Overview's parts table. Runs no check on the server. */
  scheme: () => read(schemeDto, { method: "GET", path: "/api/scheme" }),
};
