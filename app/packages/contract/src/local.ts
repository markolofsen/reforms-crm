import { z } from "zod";

// P61: the one declaration of every "open this on my Mac" action, shared by the admin, the server and `hub open`.
// Nothing else in the core builds a message:, mailto:, notion:, tg: or whatsapp: link (P131: the destinations table below). Two transports: `href` actions are links the
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
  "mail.openMessage": { transport: "href", args: z.strictObject({ messageId }), label: "Open their message" },
  // P58 R1: the Mail draft's own Message-ID (`draftMailDto.messageId`, from the card's read); `hub open mail.openDraft --draft <id>`.
  "mail.openDraft": { transport: "href", args: z.strictObject({ messageId }), label: "Open the draft in Mail" },
  "mail.compose": { transport: "href", args: z.strictObject({ to: z.string(), cc: z.string().nullable(), subject: z.string() }), label: "Reply in Mail" },
  // P131 O3: the web page; whether the Notion app opens it is decided at render by this Mac's apps (`openLinkOf`), not by a caller.
  "notion.openPage": { transport: "href", args: z.strictObject({ pageId }), label: "Open in Notion" },
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
  "notion.openPage": (a) => `https://www.notion.so/${a.pageId}`,
};

// ---- P131: the destinations, one declarative table (O1). Each kind says how its web URL is recognised, how it becomes the
// app's URL, and which macOS app it needs (the server probes each with `open -Ra <app>`, O2). The admin's `openLinkOf` and
// the server's `urlRefusal` both read it, so the allow-list and the builder cannot disagree. A link only opens the app:
// no text is ever prefilled (WhatsApp's and Telegram's `text=` stay unused, verdict 9).

/** The apps a destination can need, by kind: the name `open -Ra` looks up. Mail is always there and is not probed. */
export const DESTINATION_APPS = { notion: "Notion", telegram: "Telegram", whatsapp: "WhatsApp" } as const;
export type AppKind = keyof typeof DESTINATION_APPS;
export const APP_KINDS = Object.keys(DESTINATION_APPS) as AppKind[];

/** Which of the destination apps this Mac has (the server's probe): false when unknown, so the web link is used. */
export const appsDto = z.strictObject({ notion: z.boolean(), telegram: z.boolean(), whatsapp: z.boolean() });
export type AppsDto = z.infer<typeof appsDto>;
export const NO_APPS: AppsDto = { notion: false, telegram: false, whatsapp: false };

/** One destination: its web form (opened in a new tab) and its app form (handed to the app), either null when it has none. */
export type Destination = { kind: AppKind | "mail"; web: string | null; app: string | null };

const NOTION_ID = /(?:^|[^0-9a-f])([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f])/i;
/** `www.notion.so`, `notion.so`, `<site>.notion.site`, `notion.com`, `www.notion.com`, `app.notion.com`: the host part of a page link. */
const NOTION_HOST = /^(?:(?:www\.)?notion\.so|[a-z0-9-]+\.notion\.site|(?:www\.|app\.)?notion\.com)$/i;
/** A page link's own query: a database view (`v=`), a peek (`p=`, `pm=`) or Notion's share marker (`pvs=`); nothing else. */
const NOTION_QUERY = /^\?(?:(?:v|p|pm|pvs)=[A-Za-z0-9-]{1,64})(?:&(?:v|p|pm|pvs)=[A-Za-z0-9-]{1,64})*$/;
const NOTION_URL = /^(https|notion):\/\/([^/?#\s]+)(\/[^?#\s]*)(\?[^#\s]*)?$/i;
/** A Telegram username as `t.me` takes it: a letter, then letters, digits or `_`, 4 to 32 in all. */
const TG_USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/** A phone number as digits with the country code (`+`, spaces, dots, dashes and brackets stripped), or null: 7 to 15 digits. */
export function phoneDigits(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!/^\+?[\d\s().-]+$/.test(t)) return null;
  const d = t.replace(/\D/g, "");
  return d.length >= 7 && d.length <= 15 ? d : null;
}

/** A Notion page link (web or app form, any host of `NOTION_HOST`, a slug, dashes, a view): its two forms, else null. */
function notionDestination(url: string): Destination | null {
  const m = NOTION_URL.exec(url);
  if (!m) return null;
  const [, , host = "", path = "", query = ""] = m;
  if (!NOTION_HOST.test(host) || !NOTION_ID.test(path) || (query !== "" && !NOTION_QUERY.test(query))) return null;
  if (/[^A-Za-z0-9/_.~%-]/.test(path) || path.includes("..")) return null;
  const rest = `${host}${path}${query}`;
  return { kind: "notion", web: `https://${rest}`, app: `notion://${rest}` };
}

/** Telegram by username (web `t.me`, app `tg://resolve?domain=`) or, without one, by phone (app only: a phone has no reliable web form). */
export function telegramDestination(o: { username?: string | null; phone?: string | null }): Destination | null {
  const user = (o.username ?? "").trim().replace(/^@/, "");
  if (TG_USERNAME.test(user)) return { kind: "telegram", web: `https://t.me/${user}`, app: `tg://resolve?domain=${user}` };
  const digits = phoneDigits(o.phone);
  return digits ? { kind: "telegram", web: null, app: `tg://resolve?phone=${digits}` } : null;
}

/** WhatsApp's one-to-one chat by number (web `wa.me`, app `whatsapp://send?phone=`); a group has no link by id, so none. */
export function whatsappDestination(phone: string | null | undefined): Destination | null {
  const digits = phoneDigits(phone);
  return digits ? { kind: "whatsapp", web: `https://wa.me/${digits}`, app: `whatsapp://send?phone=${digits}` } : null;
}

/** A Notion page by id: the destination of `notion.openPage`. */
export function notionPageDestination(id: string | null | undefined): Destination | null {
  const parsed = pageId.safeParse(id ?? "");
  return parsed.success ? notionDestination(`https://www.notion.so/${parsed.data}`) : null;
}

/** Any link the table knows, in either form: Notion, Telegram, WhatsApp; Mail's `message:` and `mailto:` (app only). Null otherwise. */
export function destinationOf(url: string): Destination | null {
  if (/[\s\u0000-\u001f]/.test(url)) return null;
  if (/^(message|mailto):/i.test(url)) return { kind: "mail", web: null, app: url };
  const notion = notionDestination(url);
  if (notion) return notion;
  const tme = /^https:\/\/t\.me\/([A-Za-z0-9_]+)$/.exec(url);
  if (tme) return telegramDestination({ username: tme[1] });
  const tg = /^tg:\/\/resolve\?(domain|phone)=([A-Za-z0-9_+]+)$/.exec(url);
  if (tg) return tg[1] === "domain" ? telegramDestination({ username: tg[2] }) : telegramDestination({ phone: tg[2] });
  const wa = /^(?:https:\/\/wa\.me\/|whatsapp:\/\/send\?phone=)(\d+)$/.exec(url);
  if (wa) return whatsappDestination(wa[1]);
  return null;
}

/**
 * The URLs any opener in the core may hand to the OS: Mail's two schemes, the destinations of the table (both forms, exactly
 * as the table builds them), and the admin page itself (for `hub up`, with `adminPort`). Anything else is refused, naming its scheme.
 */
export const ALLOWED_SCHEMES = ["message:", "mailto:", "notion:", "tg:", "whatsapp:", "https:", "http:"] as const;

export function urlRefusal(url: string, o: { adminPort?: number } = {}): string | null {
  // By pattern, not `URL`: this package runs in the browser and in Node and declares neither's types.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return "not a URL";
  if (/[\s\u0000-\u001f]/.test(url)) return `the ${scheme} link holds a space or a control character`;
  const d = destinationOf(url);
  if (d && (d.web === url || d.app === url)) return null;
  const admin = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/?$/.exec(url);
  if (scheme === "http" && o.adminPort !== undefined && admin?.[1] === String(o.adminPort)) return null;
  return `the ${scheme} scheme is not one the hub opens`;
}

/** How the admin opens a destination on this Mac: the app's URL in the same tab when the app is here, else the web page in a new tab. */
export type OpenLink = { href: string; newTab: boolean; inApp: boolean; label: string };

const APP_LABEL: Record<AppKind, string> = { notion: "Open in Notion", telegram: "Open in Telegram", whatsapp: "Open in WhatsApp" };

/**
 * The one decision of P131 verdict 3: `apps` is the server's probe and `local` whether this server opens locally (macOS). The
 * app form when its app is here, else the web form; a destination with only an app form (a Telegram phone) needs the app.
 * Null when it cannot be opened here. The label says where it opens.
 */
export function openLinkOf(d: Destination | null, apps: AppsDto, local: boolean): OpenLink | null {
  if (!d) return null;
  if (d.kind === "mail") return d.app ? { href: d.app, newTab: false, inApp: true, label: "Open in Mail" } : null;
  const appHere = local && apps[d.kind] && d.app !== null;
  if (appHere && d.app) return { href: d.app, newTab: false, inApp: true, label: APP_LABEL[d.kind] };
  return d.web ? { href: d.web, newTab: true, inApp: false, label: d.kind === "notion" ? "Open in browser" : `${APP_LABEL[d.kind]} (web)` } : null;
}

/** The Notion card's or the chat's identity for the two chat apps (P131 O5): a Telegram username or phone, a WhatsApp number. */
export const contactLinksDto = z.strictObject({ telegramUsername: z.string().nullable(), telegramPhone: z.string().nullable(), whatsappPhone: z.string().nullable() });
export type ContactLinksDto = z.infer<typeof contactLinksDto>;
export const NO_CONTACT: ContactLinksDto = { telegramUsername: null, telegramPhone: null, whatsappPhone: null };

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
