import { z } from "zod";

// The project list, one project's page (P41) and its Quick Links (P64): what the API answers about a project folder.

export const projectsDto = z.object({ projects: z.array(z.string()) });

// The Project screen: what the files of one project folder say, in numbers. Each section is read on its own, so one
// broken file shows as that section's error and never blanks the screen.
const section = <T extends z.ZodRawShape>(shape: T) =>
  z.discriminatedUnion("state", [z.object({ state: z.literal("absent") }), z.object({ state: z.literal("error"), message: z.string() }), z.object({ state: z.literal("ok"), ...shape })]);

export const projectOverviewDto = z.object({
  project: z.object({ slug: z.string(), name: z.string(), status: z.string(), kind: z.string(), archived: z.boolean(), syncedAt: z.string() }).nullable(),
  question: z.object({ question: z.string(), options: z.array(z.string()) }).nullable(),
  messengerPolicy: z
    .object({
      language: z.string().nullable(),
      instruction: z.string().nullable(),
    })
    .nullable()
    .optional(),
  knowledge: section({
    indexed: z.number(),
    approved: z.number(),
    unapproved: z.number(),
    expired: z.number(),
    noAudiences: z.number(),
    noPhrasings: z.number(),
    problems: z.number(),
    consistent: z.boolean(),
    examples: z.array(z.string()),
  }),
  filters: section({ rules: z.number(), whitelist: z.number(), issues: z.array(z.string()) }),
});
export type ProjectOverviewDto = z.infer<typeof projectOverviewDto>;

/** P101: the project's declared Quick Links, with Notion role targets resolved to safe local-opening hrefs when possible. */
export const projectLinkDto = z.object({
  group: z.string(),
  label: z.string(),
  target: z.string(),
  under: z.string().nullable(),
  kind: z.enum(["notion", "https"]),
  href: z.string().nullable(),
});
export type ProjectLinkDto = z.infer<typeof projectLinkDto>;
export const projectLinksDto = z.object({
  project: z.string(),
  notion: z.object({ state: z.enum(["ready", "missing_token", "unresolved", "error"]), message: z.string().nullable() }),
  links: z.array(projectLinkDto),
});
export type ProjectLinksDto = z.infer<typeof projectLinksDto>;
