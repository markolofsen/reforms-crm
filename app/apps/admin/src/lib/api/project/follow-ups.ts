import { listFollowUps, runFollowUps, setFollowUp } from "@hub/api";
import { followUpChangedDto, followUpsDto, runFollowUpsDto, type SetFollowUpBody } from "@hub/contract/follow-ups";
import { readGenerated } from "../client";

/**
 * The daily follow-up sweep of one project (P142 F6, decision 0050): the plans, today's counts and the sweep's state; Run
 * follow-ups now; the owner's three moves on one plan (a date, Stop, Resume). Nothing here drafts or sends: a sweep only writes
 * drafts and plans, and a write here only delays or stops (no ticket, verdict 15).
 */
export const followUpsApi = {
  list: (project: string) => readGenerated(listFollowUps(project), followUpsDto),
  /** The server answers 202: the sweep runs in the background (or the click joins the one running). */
  run: (project: string) => readGenerated(runFollowUps(project, {}), runFollowUpsDto, [202]),
  set: (project: string, clientId: number, body: SetFollowUpBody) => readGenerated(setFollowUp(project, clientId, body), followUpChangedDto),
};
