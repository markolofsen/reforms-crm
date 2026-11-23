import { checkDraftRecipients, projectStore } from "@hub/projects";

// P126 D1: the one project fact the messenger door (`@hub/messengers/door`) needs, read by composition so the messengers
// package reads no project file: may this project send to `entry` (`telegram:<id>`, `whatsapp:+<number>`)? Read live on each
// assessment, never cached; a project file that does not load refuses.

export function messengerRecipients(o: { projectsDir: string; policyDir: string; allowList: string[] }): (project: string, entry: string) => string | null {
  return (project, entry) => {
    try {
      const config = projectStore({ projects: o.projectsDir, stateProjects: o.policyDir }).config(project);
      if (checkDraftRecipients(config, [entry], o.allowList).ok) return null;
      return config.draft.recipients === "test" ? `this project sends in test mode (draft.recipients: test) and ${entry} is not on allow_list in config/config.json` : `draft.recipients of ${project} does not permit ${entry}`;
    } catch {
      return `the project file of ${project} cannot be read, so who it may send to is unknown`;
    }
  };
}
