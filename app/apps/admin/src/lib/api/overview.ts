import { getOpsErrors, getOpsLines, getOverview, getScheme } from "@hub/api";
import { overviewDto } from "@hub/contract/overview";
import { opsErrorsDto, opsLinesDto } from "@hub/contract/ops-log";
import { schemeDto } from "@hub/contract/scheme";
import { readGenerated } from "./client";

/** The Overview (contract v5): one GET of local facts, one row per project with its status. No live read exists. */
export const overviewApi = {
  get: () => readGenerated(getOverview(), overviewDto),
  /** The Hub's parts and how each stands (P63 O1): Overview's parts table. Runs no check on the server. */
  scheme: () => readGenerated(getScheme(), schemeDto),
  /** P86: the newest error lines of the ops log (Recent errors). */
  opsErrors: () => readGenerated(getOpsErrors(), opsErrorsDto),
  /** P137 L3: the last day's warn and error lines (Activity ▸ Errors). */
  opsLines: () => readGenerated(getOpsLines(), opsLinesDto),
};
