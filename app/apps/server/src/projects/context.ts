import type { Repos } from "@hub/db";
import type { ProjectStore } from "@hub/projects/store";
import type { ProjectLinksOptions } from "./links";
import type { FollowUpsRuntime } from "../follow-ups/start";
import type { LeadPassRuntime } from "../passes/start";

/** The projects domain's context (P126 S1): the catalog, a project's page, its Quick Links, sequences and knowledge. */
export type ProjectsContext = {
  repos: Repos;
  /** The projects folder (`projects/` under `HUB_HOME`). */
  root: string;
  /** `hubPaths().stateProjects`: the send policy files. */
  policyDir?: string;
  projects: ProjectStore;
  now: () => Date;
  timeZone?: string;
  /** P101: Quick Links' injected read-only Notion reader. */
  links?: ProjectLinksOptions;
  /** P142: the follow-up sweep (its timer, Run now); absent: no model on this server, the plans are read only. */
  followUps?: FollowUpsRuntime;
  /** P147 (decision 0055): the daily lead pass (its timer, Run now); absent: no model on this server, the decisions are read only. */
  leadPass?: LeadPassRuntime;
  /** The admin's port: the follow-up writes take its exact Origin. */
  adminPort?: number;
  /** P147 F3: the agent send token (decision 0046); `hub mcp`'s `lead_pass_start` presents it to start a pass from the dock. */
  agentToken?: string;
};
