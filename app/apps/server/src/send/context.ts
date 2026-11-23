import type { Repos } from "@hub/db";
import type { Mailer, SendDeps, BatchLimits } from "@hub/send";
import type { DraftWriter } from "@hub/mail-app/writer/types";
import type { LogEvent } from "@hub/log/event";
import type { MessengerSenders } from "@hub/messengers/door";
import type { TicketStore } from "../http/admin-gate";
import type { BatchRuns } from "./batch-door";

/** What the send routes need from the process: the Mailer, where project.md lives, and `allow_list` for `draft.recipients: test`. */
export interface SenderOptions {
  mailer: Mailer;
  projectsDir: string;
  /** `hubPaths().stateProjects`: the send policy files (P49 S11). */
  policyDir: string;
  allowList: string[];
  /** The admin's port: a send ticket is minted only for its exact origin (P49 S12). */
  adminPort: number;
  /** Tests: the ticket store (its clock). */
  tickets?: TicketStore;
  now?: () => Date;
  /** The hub's Mail draft writer (P56: a person's Save and Restore go through the agent's one writer); absent, both refuse. */
  writer?: DraftWriter;
  /** Bumps the live topic `mail` of a project after the server wrote one of its Mail drafts, so every open tab reads it again. */
  mailWritten?: (project: string) => void;
  /** Which Mailer this is; with the fake (the e2e run only) `HUB_BATCH_SPACING_SECONDS` may shorten the batch spacing. */
  kind?: "mail-app" | "fake";
  /** P85b: the runs of Send all Checked (tests pass their own, with their own limits). */
  batchRuns?: BatchRuns;
  batchLimits?: BatchLimits;
  /** P89: told after each confirmed send (the Notion stamp of who sent); see `SendDeps.onSent`. */
  onSent?: SendDeps["onSent"];
  /** Decision 0046: the agent's send on the owner's word; absent, the agent send route refuses. */
  agent?: AgentSendOptions;
}

/** What the agent send route needs (decision 0046): the token `hub mcp` presents, the instance's mode, the session log. */
export interface AgentSendOptions {
  /** The server's token (`state/secrets/agent-send-token`), made at start. */
  token: string;
  /** `agent.unattended` of the instance, read per call: an unattended instance never sends on the agent's call. */
  unattended: () => boolean;
  /** The project's `prompt` and `focus` events of the session log since `since`. */
  events: (project: string, since: string) => readonly LogEvent[];
}

/** The send domain's context (P126 S1): the Mail door and the messenger door. */
export type SendContext = {
  repos: Repos;
  sender?: SenderOptions;
  messengers?: MessengerSenders;
};
