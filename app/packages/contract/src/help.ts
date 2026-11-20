/**
 * What to say to the agent (P63 O3): the phrases Help lists, most used first. Each `example` is one of the "Example" column's
 * phrases in `skills/README.md`, word for word, in English (P81: the admin is English, rule 6; the agent takes his own words in
 * any language) (a docs test fails when they differ, `apps/installer/test/help-phrases.test.ts`),
 * and `what` says in one plain line what happens. A phrase is one way to say it, not a trigger: the agent picks the skill by
 * what he wants (decision 0012). `X` stands for the project; Help shows the project's name in its place.
 *
 * Not read from the skills' own frontmatter (the plan's `metadata.example`): whether both CLIs load a SKILL.md with a `metadata`
 * map can only be confirmed in a real session, which this track does not start; the README is the owner-facing copy already.
 */
export interface SayDto {
  /** The skill folder's name. */
  skill: string;
  example: string;
  what: string;
}

export const SAY = [
  { skill: "triage-mail", example: "triage mail for X", what: "Reads new client mail and leaves one unsent reply draft per waiting client" },
  { skill: "triage-messages", example: "triage messages for X", what: "Reads the chats you linked and leaves one unsent draft per chat that waits, bound by the chat's rules" },
  { skill: "triage-mail", example: "handle the mail from <address> in project X", what: "One client: the whole history, one draft, the Notion profile" },
  { skill: "owner-inbox", example: "what do you need from me on X", what: "One ranked list of what waits for you, each with what to say next" },
  { skill: "status", example: "does everything work in X", what: "Runs the project's checks and says what to fix; changes nothing" },
  { skill: "bulk-drafts", example: "write a follow-up to the clients of X: <who and why>", what: "The agent picks the clients from your words and drafts one mail each" },
  { skill: "sequence-drafts", example: "prepare the follow-ups of X", what: "Drafts the follow-ups that are due, after checking each client again" },
  { skill: "review-sent", example: "look at what I sent for X", what: "Compares what you sent with the drafts and suggests tone and knowledge changes" },
  { skill: "calendar", example: "what do I have this week on X", what: "Reads the project's calendar; a hold is made only after your yes" },
  { skill: "triage-mail", example: "link this Drive folder to client <X>", what: "Links a Drive folder or file to the client's Notion profile; never shares it" },
  { skill: "kb-review", example: "kb review X", what: "Turns the agent's knowledge gaps into entries to add or fix" },
  { skill: "knowledge-import", example: "load the knowledge of X", what: "Fills the knowledge base from files and indexes it" },
  { skill: "mail-filters", example: "set up the mail filters of X", what: "Proposes Gmail filter rules from a sample of senders; never changes Gmail" },
  { skill: "project-setup", example: "set up project X", what: "A short interview, one question at a time, that writes project.md" },
  { skill: "notion-project-deploy", example: "deploy the CRM of X in Notion", what: "Creates the missing Notion databases after a dry run and your go" },
  { skill: "lead-form-check", example: "do the lead forms still work", what: "Checks the public lead forms and says who fixes a red one; never submits a lead" },
] as const satisfies readonly SayDto[];

export type SaySkill = (typeof SAY)[number]["skill"];

const PROJECT = /(?<!<)\bX\b(?!>)/g;

/** The phrase as he would say it: `X` (the project, not `<X>`, a client) becomes the project's name. */
export const sayFor = (example: string, project: string): string => example.replace(PROJECT, project);

/**
 * The one phrase for a skill (P81): the first `SAY` row of that skill, with the project's name, or without the project when none
 * is known ("set up project"). Every screen that names a phrase (an empty state, a fix line) takes it from here, never types its
 * own, so the admin speaks one language (rule 6) and one wording.
 */
export function phrase(skill: SaySkill, project?: string): string {
  const example = SAY.find((s) => s.skill === skill)?.example ?? skill;
  return project ? sayFor(example, project) : example.replace(/\s+(?:(?:of|for|in|on)\s+)?(?<!<)\bX\b(?!>)/g, "");
}
