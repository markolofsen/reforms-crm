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
  { skill: "sort-chats", example: "sort the chats of X", what: "Proposes hiding the unlinked chats that are not clients, each with its reason; you confirm the list once" },
  { skill: "triage-mail", example: "handle the mail from <address> in project X", what: "One client: the whole history, one draft, the Notion profile" },
  { skill: "owner-inbox", example: "what do you need from me on X", what: "One ranked list of what waits for you, each with what to say next" },
  { skill: "status", example: "does everything work in X", what: "Runs the project's checks and says what to fix; changes nothing" },
  { skill: "bulk-drafts", example: "write a follow-up to the clients of X: <who and why>", what: "The agent picks the clients from your words and drafts one mail each; they arrive as one batch, a line on top of Mail ▸ Needs you while they wait, sent with Review all (Send all Checked)" },
  { skill: "bulk-drafts", example: "write to <client> of X again: <what about>", what: "A new message on your initiative in the client's latest thread, even when they have not answered; you send it" },
  { skill: "bulk-drafts", example: "write a first mail to <client> of X: <what about>", what: "A new thread to a client you never wrote to, from the project's sender; you send it" },
  { skill: "sequence-drafts", example: "prepare the follow-ups of X", what: "Drafts the follow-ups that are due, after checking each client again" },
  { skill: "review-maps", example: "review the maps of X", what: "Redraws the client maps that are a week old or missing, from each client's whole history; no draft, nothing sent" },
  { skill: "review-sent", example: "look at what I sent for X", what: "Compares what you sent with the drafts and suggests tone and knowledge changes" },
  { skill: "calendar", example: "what do I have this week on X", what: "Reads the project's calendar; a hold is made only after your yes" },
  { skill: "triage-mail", example: "link this Drive folder to client <X>", what: "Links a Drive folder or file to the client's Notion profile; never shares it" },
  { skill: "kb-review", example: "kb review X", what: "Turns the agent's knowledge gaps into entries to add or fix" },
  { skill: "watch", example: "what do the watched groups of X talk about", what: "Reads the Watch's data and advises; adds or removes a group, or a topic or trigger, on your word" },
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

/** The most clients one Prepare names (P96 verdict 7: the bulk limit). */
export const PREPARE_MAX = 30;

/**
 * P96 S2: the request Prepare reply (one client) and Prepare all (every Inbox row, at most `PREPARE_MAX`) paste into the dock,
 * without Enter: the one-client phrase of `triage-mail` ("handle the mail from <address> in project X") naming each client's
 * address and the subject they wrote, so the session drafts exactly those. One line: no line break reaches the terminal.
 */
export function preparePhrase(project: string, clients: ReadonlyArray<{ email: string; subject: string }>): string {
  const example = SAY.find((s) => s.example.startsWith("handle the mail from"))?.example ?? "handle the mail from <address> in project X";
  const one = (c: { email: string; subject: string }) => {
    const subject = c.subject.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    return subject ? `${c.email} (${subject})` : c.email;
  };
  const list = clients.slice(0, PREPARE_MAX);
  const line = sayFor(example, project).replace("<address>", list.map(one).join(", "));
  return list.length > 1 ? `${line}: one draft each` : line;
}

/**
 * P97 S3: the request a lead's Prepare reply pastes into the dock, without Enter: skill bulk-drafts' first-mail phrase ("write a
 * first mail to <client> of X: <what about>") naming the lead's reply address, its Notion page id and brand, so the session writes
 * one new-thread draft with the Leads row as its context. One line.
 */
export function leadPhrase(project: string, lead: { email: string; pageId: string; brand: string | null }): string {
  const example = SAY.find((s) => s.example.startsWith("write a first mail to"))?.example ?? "write a first mail to <client> of X: <what about>";
  const what = `answer their website request (Notion lead ${lead.pageId}${lead.brand ? `, brand ${lead.brand}` : ""})`;
  return sayFor(example, project).replace("<client>", lead.email).replace("<what about>", what);
}

/** P106: the runtime-agent handoff from one Messenger row; unlike the project-wide triage phrase it names exactly one linked chat. */
export function messengerPhrase(project: string, chat: { channel: string; chatId: string; clientName?: string | null }): string {
  const who = chat.clientName ? ` for ${chat.clientName}` : "";
  return `Prepare one reply${who} from the ${chat.channel} chat ${chat.chatId} in project ${project}. Read only this linked chat with messenger_history, then leave one unsent draft with messenger_draft_write; do not send anything.`;
}

/** One line, no control character: what reaches the dock terminal never holds a line break (so nothing is entered by itself). */
const oneLine = (s: string, max: number): string => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const clientOf = (c: { name: string; email: string | null }): string => {
  const name = oneLine(c.name, 80);
  // P141 C1: a client known only by a chat is named by its name alone.
  if (!c.email) return name;
  const email = oneLine(c.email, 320);
  return name && name !== email ? `${name} <${email}>` : email;
};

/**
 * P136 verdict 7d: the request the client map sheet's Correct puts into the dock, without Enter: "redraw the map of <client>: ",
 * for the owner to finish with what is wrong and press Enter himself. It ends in a space; nothing after it is ours.
 */
export const mapCorrectPhrase = (client: { name: string; email: string | null }): string => `redraw the map of ${clientOf(client)}: `;

/** P136 verdict 7a: "Draw map" (a client with none) puts this into the dock, without Enter; the owner presses Enter. */
export const mapDrawPhrase = (client: { name: string; email: string | null }): string => `draw the map of ${clientOf(client)} from their whole history`;
