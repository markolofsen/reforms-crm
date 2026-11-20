import { z } from "zod";

// P61: the one declaration of every "open this on my Mac" action, shared by the admin, the server and `hub open`.
// Nothing else in the core builds a message:, mailto: or notion: link. Two transports: `href` actions are links the
// browser hands to the OS itself (no server round trip, nothing executes on the server); `server` actions reach a file
// or folder of the instance, so only the server may run them (`POST /api/local/:action`), from a KEY it resolves
// itself (`@hub/projects/local-open`), never from a path the browser sends.

/** The project slug pattern of `@hub/projects` (`values.ts` SLUG). */
const slug = z.string().regex(/^[a-z0-9-]+$/, "not a project slug");

/** A Message-ID, `<local@host>` or `local@host`: no whitespace and no inner `<>`. */
const messageId = z.string().trim().regex(/^<?[^<>\s]+@[^<>\s]+>?$/, "not a Message-ID");

/** A Notion page id: 32 hex digits, dashes optional, any case. */
const pageId = z
  .string()
  .transform((s) => s.trim().replaceAll("-", "").toLowerCase())
  .pipe(z.string().regex(/^[0-9a-f]{32}$/, "not a Notion page id"));

/** One knowledge entry as the index holds it: a path relative to the project folder, under `knowledge/`, never `..`, `~` or absolute. */
export function isEntryPath(p: string): boolean {
  if (!p.startsWith("knowledge/") || p.length > 400) return false;
  if (/[\u0000-\u001f\\]/.test(p)) return false;
  return p.split("/").every((seg, i) => seg !== "" && seg !== "." && seg !== ".." && (i > 0 || seg === "knowledge"));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Folder keys: the project folder, its knowledge base, its workflows. */
export const FOLDER_KEYS = ["project", "knowledge", "workflows"] as const;
export type FolderKey = (typeof FOLDER_KEYS)[number];

const folderKey = z.enum(FOLDER_KEYS);
/** File keys: `project.md`, one indexed knowledge entry (`knowledge:<index path>`), one day of the agent log (`log:<YYYY-MM-DD>`). */
const fileKey = z.string().refine((k) => k === "project.md" || (k.startsWith("knowledge:") && isEntryPath(k.slice("knowledge:".length))) || (k.startsWith("log:") && DAY.test(k.slice(4))), "not a file key (project.md, knowledge:<entry>, log:<YYYY-MM-DD>)");
const anyKey = z.union([folderKey, fileKey]);

/** The key of one knowledge entry, from the path the index (and the Knowledge table) shows. */
export const entryKey = (entry: string): string => `knowledge:${entry}`;

/** A dock tab id (the terminal's session id): letters, digits, `-` and `_`. */
const tab = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, "not a tab id");

type Def = { transport: "href" | "server"; args: z.ZodType; label: string; /** False: the action is declared, the server refuses it (501) with `refusal`. */ offered?: boolean; refusal?: string };

/** Why the desktop handoff is off (P61 section 9, owner item 7): the one sentence the route, the CLI and the button say. */
export const DESKTOP_NOT_OFFERED = "Not offered: Claude Desktop would run this session without the hub's rules";

export const LOCAL_ACTIONS = {
  // The client's message (the draft's mailRef). P58 R1: the card's Open goes to the draft itself; this is its fallback and a More item.
  "mail.openMessage": { transport: "href", args: z.strictObject({ messageId }), label: "Open the client's mail" },
  // P58 R1: the Mail draft's own Message-ID (`draftMailDto.messageId`, from the card's read); `hub open mail.openDraft --draft <id>`.
  "mail.openDraft": { transport: "href", args: z.strictObject({ messageId }), label: "Open draft in Mail" },
  "mail.compose": { transport: "href", args: z.strictObject({ to: z.string(), cc: z.string().nullable(), subject: z.string() }), label: "Reply in Mail" },
  "notion.openPage": { transport: "href", args: z.strictObject({ pageId, app: z.boolean() }), label: "Open in Notion" },
  "finder.open": { transport: "server", args: z.strictObject({ project: slug, key: folderKey }), label: "Open folder" },
  "finder.reveal": { transport: "server", args: z.strictObject({ project: slug, key: anyKey }), label: "Show in Finder" },
  "file.open": { transport: "server", args: z.strictObject({ project: slug, key: fileKey }), label: "Open" },
  // P87 (B1): Apple Mail itself, from Overview's "Apple Mail is not running" item: the owner's click only. The Hub never starts
  // Mail on its own (decision 0030 note: Mail sends what waits in its Outbox when it opens); no argument, nothing else opens.
  "mail.openApp": { transport: "server", args: z.strictObject({}), label: "Open Mail" },
  "agent.openInDesktop": { transport: "server", args: z.strictObject({ project: slug, tab }), label: "Open in Claude Desktop", offered: false, refusal: DESKTOP_NOT_OFFERED },
} as const satisfies Record<string, Def>;

type Actions = typeof LOCAL_ACTIONS;
export type LocalActionId = keyof Actions;
export type HrefActionId = { [A in LocalActionId]: Actions[A]["transport"] extends "href" ? A : never }[LocalActionId];
export type ServerActionId = Exclude<LocalActionId, HrefActionId>;
/** What a caller passes (before the schema's own trimming). */
export type LocalArgs<A extends LocalActionId> = z.input<Actions[A]["args"]>;

export const LOCAL_ACTION_IDS = Object.keys(LOCAL_ACTIONS) as LocalActionId[];
export const isLocalAction = (id: string): id is LocalActionId => Object.hasOwn(LOCAL_ACTIONS, id);
export const isServerAction = (id: LocalActionId): id is ServerActionId => LOCAL_ACTIONS[id].transport === "server";

const recipients = (list: string): string => list.split(/[,;]/).map((a) => a.trim()).filter((a) => a !== "").map(encodeURIComponent).join(",");
const message = (id: string) => `message://${encodeURIComponent(`<${id.replace(/^<|>$/g, "")}>`)}`;

const BUILD: { [A in HrefActionId]: (a: z.output<Actions[A]["args"]>) => string } = {
  "mail.openMessage": (a) => message(a.messageId),
  "mail.openDraft": (a) => message(a.messageId),
  // A compose window addressed and titled; nothing is sent. Recipients separated by a literal comma (RFC 6068), each encoded alone; the subject encoded so `&`, `+` and spaces survive.
  "mail.compose": (a) => {
    const cc = a.cc ? recipients(a.cc) : "";
    return `mailto:${recipients(a.to)}?subject=${encodeURIComponent(a.subject)}${cc ? `&cc=${cc}` : ""}`;
  },
  "notion.openPage": (a) => (a.app ? `notion://www.notion.so/${a.pageId}` : `https://www.notion.so/${a.pageId}`),
};

/**
 * The URLs any opener in the core may hand to the OS: Mail's two schemes, a Notion page by id (web or app), and the
 * admin page itself (for `hub up`, with `adminPort`). Anything else is refused, naming its scheme.
 */
export const ALLOWED_SCHEMES = ["message:", "mailto:", "notion:", "https:", "http:"] as const;

export function urlRefusal(url: string, o: { adminPort?: number } = {}): string | null {
  // By pattern, not `URL`: this package runs in the browser and in Node and declares neither's types.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return "not a URL";
  if (/[\s\u0000-\u001f]/.test(url)) return `the ${scheme} link holds a space or a control character`;
  if (scheme === "message" || scheme === "mailto") return null;
  if ((scheme === "notion" || scheme === "https") && /^[a-z]+:\/\/www\.notion\.so\/[0-9a-f]{32}$/.test(url)) return null;
  const admin = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/?$/.exec(url);
  if (scheme === "http" && o.adminPort !== undefined && admin?.[1] === String(o.adminPort)) return null;
  return `the ${scheme} scheme is not one the hub opens`;
}

/** The link of an `href` action, or null when its arguments are not valid (no Message-ID, not a Notion id). */
export function hrefOf<A extends HrefActionId>(action: A, args: LocalArgs<A>): string | null {
  const parsed = LOCAL_ACTIONS[action].args.safeParse(args);
  if (!parsed.success) return null;
  const href = (BUILD[action] as (a: unknown) => string)(parsed.data);
  return urlRefusal(href) === null ? href : null;
}

/** The same for any action and arguments not yet typed (the admin's one component): null for a `server` action or bad arguments. */
export function linkOf(action: LocalActionId, args: unknown): string | null {
  return isServerAction(action) ? null : hrefOf(action, args as LocalArgs<HrefActionId>);
}

/** The reply of a server action: the label of what opened, never a path. */
export const localOpenedDto = z.strictObject({ ok: z.literal(true), opened: z.string() });
export type LocalOpenedDto = z.infer<typeof localOpenedDto>;

/** What the dock's handoff button says for a tab's program (P61 9f); null: no button (Shell). Not offered, so every agent tab is disabled with its reason. */
export function desktopHandoffReason(preset: string): string | null {
  if (preset === "claude") return DESKTOP_NOT_OFFERED;
  if (preset === "codex") return "Codex: the ChatGPT app keeps its own sessions and settings; not offered";
  return null;
}
