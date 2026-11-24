import { getActivity, getAgentFeed, getProjectLinks, getProjectOverview } from "@hub/api";
import { activityDto, type ActivityView } from "@hub/contract/activity";
import { agentFeedDto } from "@hub/contract/agent-feed";
import { projectLinksDto, projectOverviewDto } from "@hub/contract/project";
import { readGenerated } from "../client";

/** One project's facts (P127 V13): its overview and links, the Activity timeline (P73) and the agent's feed (P59). */
export const projectApi = {
  overview: (project: string) => readGenerated(getProjectOverview({ project }), projectOverviewDto),
  links: (project: string) => readGenerated(getProjectLinks(project), projectLinksDto),
  /** P73: one page of the timeline, older than `before` (the previous page's `next`). */
  activity: (project: string, view: ActivityView, client: number | null, before: string | null) =>
    readGenerated(getActivity({ project, view, client: client ?? undefined, before: before ?? undefined }), activityDto),
  agentFeed: (project: string) => readGenerated(getAgentFeed(project), agentFeedDto),
};
