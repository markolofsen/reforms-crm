import type { Context } from "hono";
import { projectStore } from "@hub/projects/store";
import { gateRefusal } from "../admin-gate";
import type { MailServices } from "../composition/capabilities";

/**
 * What the owner's Mail draft writes share (P126 M3): the project's Mail identity read from project.md, the draft of this
 * project, the 409 sentence and the send ticket's door (exact admin Origin, same-origin fetch: a forged write from another
 * loopback page would rewrite a client's mail).
 */
export function draftMailKit({ repos, sender }: MailServices) {
  const store = sender ? projectStore({ projects: sender.projectsDir, stateProjects: sender.policyDir }) : null;
  const projectMail = (slug: string) => {
    const config = store?.find(slug);
    return config ? { ...config.mail, sender: config.mail.sender ?? null, brands: config.brands, signoff: config.signoff, languages: config.languages } : null;
  };
  const own = async (slug: string, id: number) => {
    const d = await repos.drafts.get(id);
    return d && d.project === slug ? d : null;
  };
  const refuse = (c: Context, error: string) => c.json({ error, code: "wrong_state" as const }, 409);
  const door = (c: Context) => (sender ? gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, sender.adminPort, { sameSite: true }) : "Mail is not set up on this server");
  return { projectMail, own, refuse, door };
}
