import { overviewDto } from "@hub/contract/overview";
import { opsErrorsDto } from "@hub/contract/ops-log";
import { schemeDto } from "@hub/contract/scheme";
import { read } from "./client";

/** The Overview (contract v5): one GET of local facts, one row per project with its status. No live read exists. */
export const overviewApi = {
  get: () => read(overviewDto, { method: "GET", path: "/api/overview" }),
  /** The Hub's parts and how each stands (P63 O1): Overview's parts table. Runs no check on the server. */
  scheme: () => read(schemeDto, { method: "GET", path: "/api/scheme" }),
  /** P86: the newest error lines of the ops log (Recent errors). */
  opsErrors: () => read(opsErrorsDto, { method: "GET", path: "/api/ops/errors" }),
};
