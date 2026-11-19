/**
 * What to say to the agent (P63 O3): the phrases Help lists, most used first. Each `example` is one of the "Example" column's
 * phrases in `skills/README.md`, word for word (a docs test fails when they differ, `apps/installer/test/help-phrases.test.ts`),
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

export const SAY: readonly SayDto[] = [
  { skill: "triage-mail", example: "разбери почту проекта X", what: "Reads new client mail and leaves one unsent reply draft per waiting client" },
  { skill: "triage-mail", example: "обработай письмо от <адрес> в проекте X", what: "One client: the whole history, one draft, the Notion profile" },
  { skill: "owner-inbox", example: "что от меня нужно по проекту X", what: "One ranked list of what waits for you, each with what to say next" },
  { skill: "status", example: "всё ли работает в X", what: "Runs the project's checks and says what to fix; changes nothing" },
  { skill: "bulk-drafts", example: "сделай follow-up для клиентов X: <кому и зачем>", what: "The agent picks the clients from your words and drafts one mail each" },
  { skill: "sequence-drafts", example: "подготовь follow-up проекта X", what: "Drafts the follow-ups that are due, after checking each client again" },
  { skill: "review-sent", example: "посмотри что я отправил по проекту X", what: "Compares what you sent with the drafts and suggests tone and knowledge changes" },
  { skill: "calendar", example: "что у меня на неделе по проекту X", what: "Reads the project's calendar; a hold is made only after your yes" },
  { skill: "triage-mail", example: "привяжи эту папку Drive к клиенту <X>", what: "Links a Drive folder or file to the client's Notion profile; never shares it" },
  { skill: "kb-review", example: "что улучшить в базе знаний X", what: "Turns the agent's knowledge gaps into entries to add or fix" },
  { skill: "knowledge-import", example: "загрузи знания проекта X", what: "Fills the knowledge base from files and indexes it" },
  { skill: "mail-filters", example: "настрой фильтры почты проекта X", what: "Proposes Gmail filter rules from a sample of senders; never changes Gmail" },
  { skill: "project-setup", example: "настрой проект X", what: "A short interview, one question at a time, that writes project.md" },
  { skill: "notion-project-deploy", example: "разверни CRM проекта X в Notion", what: "Creates the missing Notion databases after a dry run and your go" },
  { skill: "lead-form-check", example: "проверь формы заявок", what: "Checks the public lead forms and says who fixes a red one; never submits a lead" },
];

/** The phrase as he would say it: `X` (the project, not `<X>`, a client) becomes the project's name. */
export const sayFor = (example: string, project: string): string => example.replace(/(?<!<)\bX\b(?!>)/g, project);
