import { z } from "zod";

/**
 * Tips for the dock's agents (P63 O3, the owner's request of 2026-11-19): the one list. The dock's tips popover shows the rows of
 * the open tab's CLI and the Hub's own; Help shows all of them, grouped. Nothing else holds a copy.
 *
 * Every CLI row was checked before it shipped, against the CLI's own `--help`, the slash-command table in its binary or its docs,
 * for the version in `verifiedOn`; `hub doctor --only Agent` warns (`agent.tips`) when the installed CLI is newer, so the rows are
 * checked again after an upgrade. A Hub row (`verifiedOn: null`) is the Hub's own behaviour, held by its tests. Plain words; a tip
 * never sends anything to the agent by itself.
 */
export const TIP_CLIS = ["claude", "codex", "hub"] as const;
export type TipCli = (typeof TIP_CLIS)[number];

export const tipDto = z.strictObject({
  cli: z.enum(TIP_CLIS),
  id: z.string(),
  title: z.string(),
  /** What to do, in the owner's words: the keys, the command, the phrase. */
  how: z.string(),
  /** Why, or what to know first: the condition, the limit. */
  why: z.string(),
  /** The CLI version the row was checked on; null for a Hub row. */
  verifiedOn: z.string().nullable(),
  /** P61: a row about the desktop handoff shows the dock's disabled "Open in Claude Desktop" with its reason. */
  handoff: z.boolean(),
});
export type TipDto = z.infer<typeof tipDto>;

/** Headings, one per group. */
export const TIP_GROUPS: Record<TipCli, string> = { claude: "Claude Code", codex: "Codex", hub: "The Hub" };

const CLAUDE = "2.1.220";
const CODEX = "0.153.0";

export const TIPS: readonly TipDto[] = [
  {
    cli: "claude",
    id: "voice",
    title: "Speak instead of typing",
    how: "Type /voice once. Then hold Space while you speak and let go to stop: the words land in the prompt, and Enter sends them. /voice tap: tap Space to start and again to send. /voice off turns it off.",
    why: "Needs your claude.ai sign-in, not an API key. For Russian, set the language in /config. Not yet tried in the dock: macOS asks for the microphone for the app that started the Hub.",
    verifiedOn: CLAUDE,
    handoff: false,
  },
  {
    cli: "claude",
    id: "resume",
    title: "Go back to an older conversation",
    how: "Type /resume and pick one of this project's conversations.",
    why: "Opening the dock already brings back this project's last conversation (up to a day old); + starts a new one. The list also shows other projects' conversations: pick only this project's.",
    verifiedOn: CLAUDE,
    handoff: false,
  },
  {
    cli: "claude",
    id: "desktop",
    title: "Moving the chat to Claude Desktop",
    how: "/desktop (or /app) would continue this conversation in the Claude desktop app and close it here.",
    why: "The Hub does not offer it: Claude Desktop runs the conversation without the Hub's rules (no deny list, no guard, and its own connectors can send mail). Keep the work in the dock.",
    verifiedOn: CLAUDE,
    handoff: true,
  },
  {
    cli: "codex",
    id: "resume",
    title: "Your last conversation comes back",
    how: "Opening the dock brings back this project's last Codex conversation (up to a day old); + starts a new one.",
    why: "Only while the Hub's rules for Codex are the same as when it started; otherwise a new one starts and the line under the tabs says why.",
    verifiedOn: CODEX,
    handoff: false,
  },
  {
    cli: "codex",
    id: "app",
    title: "Moving the chat to the ChatGPT app",
    how: "/app would open this conversation in the ChatGPT desktop app.",
    why: "The Hub does not offer it: the app runs it without the Hub's rules. Keep the work in the dock.",
    verifiedOn: CODEX,
    handoff: true,
  },
  {
    cli: "hub",
    id: "this-draft",
    title: "Answer the draft on screen",
    how: "Say “answer it” or “make it shorter”, in any language: the agent rewrites the draft open in the Hub. No need to say which.",
    why: "The agent sees what the Hub shows you. It saves a new version; you read it and decide.",
    verifiedOn: null,
    handoff: false,
  },
  {
    cli: "hub",
    id: "edit",
    title: "Change a few words yourself",
    how: "Edit on the draft's card, then ⌘ Enter saves (Esc cancels).",
    why: "Your words go to the same Mail draft the agent wrote; Send still needs “I read the checks”.",
    verifiedOn: null,
    handoff: false,
  },
  {
    cli: "hub",
    id: "hide",
    title: "Hiding the terminal stops nothing",
    how: "Hide folds the dock to a strip; the sessions keep running. × on a tab ends its session.",
    why: "A dot on the strip says the agent is working or waiting for you.",
    verifiedOn: null,
    handoff: false,
  },
];

/** The rows the dock shows for a tab: its CLI's, then the Hub's (a Shell tab: the Hub's only). */
export const tipsFor = (preset: string): TipDto[] => TIPS.filter((t) => t.cli === "hub" || t.cli === preset);

/** `2.1.285` is newer than `2.1.220`: numeric, part by part (a missing part is 0). */
export function versionNewer(a: string, b: string): boolean {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** The oldest version a CLI's rows were checked on, or null when it has none. */
export function tipsVerifiedOn(cli: Exclude<TipCli, "hub">): string | null {
  const vs = TIPS.filter((t) => t.cli === cli && t.verifiedOn !== null).map((t) => t.verifiedOn as string);
  return vs.reduce<string | null>((low, v) => (low === null || versionNewer(low, v) ? v : low), null);
}
