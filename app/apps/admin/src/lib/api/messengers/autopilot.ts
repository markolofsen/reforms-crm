import { autopilotInstanceDto, autopilotProjectDto, type SetAutopilotProjectBody } from "@hub/contract/autopilot";
import { sendTicketDto } from "@hub/contract/sending";
import { createAutopilotTicket, getAutopilot, getProjectAutopilot, setAutopilot, setProjectAutopilot } from "@hub/api";
import { readGenerated } from "../client";

/** One change without its ticket (the facade fetches it): distributes over the body's union. */
type WithoutTicket<T> = T extends unknown ? Omit<T, "ticket"> : never;
type ProjectChange = WithoutTicket<SetAutopilotProjectBody>;

/**
 * The autopilot's switches (decision 0048 point 2, P139 A1): the instance switch and one project's block. Each write fetches a
 * single-use ticket bound to its scope a moment before (only this page's own origin can mint one), then switches; the server
 * refuses a write without it. The screens are P139 A5's.
 */
export const autopilotApi = {
  instance: () => readGenerated(getAutopilot(), autopilotInstanceDto),
  project: (project: string) => readGenerated(getProjectAutopilot(project), autopilotProjectDto),
  setInstance: async (on: boolean) => {
    const { ticket } = await readGenerated(createAutopilotTicket({ scope: "instance" }), sendTicketDto);
    return readGenerated(setAutopilot({ on, ticket }), autopilotInstanceDto);
  },
  setProject: async (project: string, change: ProjectChange) => {
    const { ticket } = await readGenerated(createAutopilotTicket({ scope: "project", project }), sendTicketDto);
    return readGenerated(setProjectAutopilot(project, { ...change, ticket }), autopilotProjectDto);
  },
};
