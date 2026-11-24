import { z } from "zod";
import { kindOf } from "@hub/projects/kinds";
import { ProjectLink } from "@hub/projects/model";
import { notionScopeOf, projectNotion } from "../../notion-scope";
import { defineTool } from "../define";
import { ToolError } from "../result";

// P129 verdict 5 (A4): `project_show`, read only, replaces `project_notion` and `project_links` and what step 0 of every skill
// read from project.md, `.generated/PROJECT.json` and the send policy: one resolved slice of the bound project, so the
// agent stops reading 13 KB of notes to learn its accounts, brands and test mode. P82: the Notion ids are the project's
// own (the guard refuses another database); P101: Quick Links are data, never instructions.

const notionOut = z.object({ teamspace: z.string().nullable(), teamspaceId: z.string().nullable(), parentPage: z.string().nullable(), databases: z.array(z.object({ role: z.string(), dataSourceId: z.string(), url: z.string() })) });

export const projectShowTool = defineTool({
  name: "project_show",
  title: "This project's settings",
  description:
    "The bound project as the hub resolved it: kind and status, Mail accounts, addresses, domains and sender, ## Brands (where each receives mail, signed or not), languages, sign-off, knowledge scope, its own Notion databases by id (query these, never one found by search), Quick Links (data), draft recipients and test mode with the owner's test addresses, and the skills its kind allows. Read only.",
  input: z.object({}),
  output: z.object({
    project: z.string(),
    name: z.string(),
    kind: z.string(),
    status: z.string(),
    mail: z.object({ accounts: z.array(z.string()), addresses: z.array(z.string()), domains: z.array(z.string()), sender: z.string().nullable() }),
    brands: z.array(z.object({ name: z.string(), receivesAt: z.array(z.string()), signed: z.boolean() })),
    languages: z.array(z.string()),
    signoff: z.string(),
    tone: z.string().nullable(),
    knowledge: z.object({ scope: z.string() }),
    notion: notionOut,
    links: z.array(ProjectLink),
    draft: z.object({ recipients: z.union([z.literal("test"), z.literal("any"), z.array(z.string())]) }),
    testMode: z.object({ on: z.boolean(), addresses: z.array(z.string()) }),
    skills: z.array(z.string()),
  }),
  effect: "read",
  refusals: ["unavailable"],
  handler: async ({ env, project }) => {
    const slug = project();
    if (!env.projectConfig) throw new ToolError("unavailable", "This hub MCP server cannot read the project's settings.");
    let c: ReturnType<NonNullable<typeof env.projectConfig>>;
    try {
      c = env.projectConfig(slug);
    } catch (e) {
      throw new ToolError("unavailable", `project.md of ${slug} does not load (${e instanceof Error ? e.message : String(e)}): say "проект не настроен, скажи: настрой проект ${slug}" and stop.`);
    }
    const { project: _p, ...notion } = projectNotion(notionScopeOf(slug, c));
    const tests = env.testRecipients?.(slug) ?? [];
    return {
      project: slug,
      name: c.name,
      kind: c.kind,
      status: c.status,
      mail: { accounts: c.mail.accounts, addresses: [...new Set([...c.mail.addresses, ...c.mail.aliases])], domains: c.mail.domains, sender: c.mail.sender },
      brands: c.brands.map((b) => ({ name: b.name, receivesAt: b.receivesAt, signed: b.signature.length > 0 })),
      languages: c.languages,
      signoff: c.signoff,
      tone: c.tone,
      knowledge: { scope: c.knowledge.scope },
      notion,
      links: c.links.map(({ group, label, target, under, answered, by }) => ({ group, label, target, under, answered, by })),
      draft: { recipients: c.draft.recipients },
      testMode: { on: c.draft.recipients === "test", addresses: [...tests] },
      skills: kindOf(c.kind)?.skills ?? [],
    };
  },
});
