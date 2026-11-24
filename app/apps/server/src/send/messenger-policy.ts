import { createHash } from "node:crypto";
import type { MessengerProjectPolicy } from "@hub/messengers/door";
import { checkDraftRecipients } from "@hub/projects/guard";
import { readSendPolicy } from "@hub/projects/send-policy";
import { projectStore } from "@hub/projects/store";

// P126 D1, P112 S2: the project facts the messenger door (`@hub/messengers/door`) needs, read by composition so the messengers
// package reads no project file: is the project active (its lifecycle), which send policy is in force (its generation: a hash
// of the policy as read, so any change shows), and may it send to `entry` (`telegram:<id>`, `whatsapp:+<number>`)? Read live
// on every call, never cached; a project file that does not load refuses (once, as its lifecycle).

export function messengerPolicy(o: { projectsDir: string; policyDir: string; allowList: string[] }): (project: string) => MessengerProjectPolicy {
  return (project) => {
    let config;
    try {
      config = projectStore({ projects: o.projectsDir, stateProjects: o.policyDir }).config(project);
    } catch {
      return { lifecycle: `the project file of ${project} cannot be read, so whether and to whom it may send is unknown`, generation: "unreadable", recipients: () => null };
    }
    const state = readSendPolicy(o.policyDir, project, config.kind);
    const generation = `${state.source}:${createHash("sha256").update(JSON.stringify(state.policy)).digest("hex").slice(0, 16)}`;
    const recipients = (entry: string): string | null => {
      if (checkDraftRecipients(config, [entry], o.allowList).ok) return null;
      return config.draft.recipients === "test" ? `this project sends in test mode (draft.recipients: test) and ${entry} is not on allow_list in config/config.json` : `draft.recipients of ${project} does not permit ${entry}`;
    };
    return { lifecycle: config.status === "active" ? null : `project ${project} is ${config.status}, not active`, generation, recipients };
  };
}
