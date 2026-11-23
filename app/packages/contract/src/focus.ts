import { z } from "zod";
import { pointerId, POINTER_OUTCOMES } from "./pointer";
import { agentRef, REF_KINDS, SLUG } from "./refs";

export { agentRef, parseRef, REF_KINDS, REF_MAX, refOf, type RefKind } from "./refs";

// The shared focus (P51, decision 0029; P72, decision 0038): what the owner's admin tab shows, published to the server so
// the agent in the dock resolves "this entry", "this draft", "the selected ones". Every route publishes the same fields,
// derived from the router, never from a hand list of screens: its route id, its title, and refs. A ref is a domain id
// written `<kind>:<id>` (`draft:42`, `knowledge:knowledge/files/a.md`), the same string the admin keys its rows by
// (`data-agent-ref`). Ids only: names, titles and subjects are read from the database at read time, inside the bound
// project. Every object is strict: an unknown field is refused.

/** At most this many selected refs are published; the reader names at most {@link FOCUS_SELECTED_SHOWN}. */
export const FOCUS_SELECTED_MAX = 200;
export const FOCUS_SELECTED_SHOWN = 50;
/** The list window: at most this many refs of the rows on screen, in order. */
export const FOCUS_WINDOW_MAX = 30;
/** A visible focus older than this is stale; the publisher re-posts every {@link FOCUS_HEARTBEAT_MS} while visible. */
export const FOCUS_FRESH_MS = 10 * 60_000;
export const FOCUS_HEARTBEAT_MS = 60_000;
/** Names, titles and subjects in a focus reply are cut to this many characters (client data, labelled as data). */
export const FOCUS_TEXT_MAX = 120;
/** The prompt hook's line is at most this long. */
export const FOCUS_LINE_MAX = 400;

const slug = z.string().regex(SLUG).max(100);
const tab = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);
/** A route id of the admin's route table (`knowledge.page`, `log.list`) or `notFound`. */
const routeId = z.string().min(1).max(40).regex(/^[A-Za-z][A-Za-z.]*$/);
/** The address's search state (`filter`, `q`): at most 6 keys, each value at most 200 characters. */
const view = z.record(z.string().regex(/^[a-z]{1,20}$/), z.string().max(200)).refine((v) => Object.keys(v).length <= 6, "at most 6 view keys");

/** The outcome of the agent's last highlight (P72), posted once by the next focus post. */
export const pointerOutcome = z.strictObject({ id: pointerId, outcome: z.enum(POINTER_OUTCOMES) });

/** One tab's focus: what `POST /api/focus` takes (besides a clear) and `state/focus.json` keeps. */
export const focusPost = z.strictObject({
  tab,
  project: slug.nullable(),
  /** The route of the address, and its title as the owner reads it (the route table's word, never a hand list). */
  route: routeId,
  title: z.string().min(1).max(60),
  /** The record the address or the open card names: `draft:42`, `run:10`. */
  subject: agentRef.optional(),
  /** The row he is on: the last row in `#main` that got keyboard focus or a click (never hover). */
  pointed: agentRef.optional(),
  /** The picked rows. */
  selected: z.array(agentRef).max(FOCUS_SELECTED_MAX),
  /** The rows on screen, in order, and how many rows the list has. */
  window: z.strictObject({ refs: z.array(agentRef).max(FOCUS_WINDOW_MAX), total: z.number().int().nonnegative() }).optional(),
  view: view.optional(),
  pointer: pointerOutcome.optional(),
  visible: z.boolean(),
});
export type FocusPost = z.infer<typeof focusPost>;

/** `POST /api/focus`: one tab's focus, or that tab's clear (its `pagehide`). The server adds the time. */
export const focusInput = z.union([focusPost, z.strictObject({ tab, clear: z.literal(true) })]);
export type FocusInput = z.infer<typeof focusInput>;

/** What `state/focus.json` holds: the last post that counts, stamped with the server's clock. A `schema: 1` file reads as none. */
export const focusRecord = z.strictObject({ schema: z.literal(2), at: z.string(), focus: focusPost });
export type FocusRecord = z.infer<typeof focusRecord>;

/**
 * `fresh`: the owner's visible tab, at most 10 minutes old, on the bound project. `stale`: hidden or older. `elsewhere`: the
 * admin shows another project (named nowhere). `none`: no admin focus at all (no file, cleared, an older schema).
 */
export const FOCUS_STATES = ["fresh", "stale", "elsewhere", "none"] as const;
export type FocusState = (typeof FOCUS_STATES)[number];

/** How the agent reads an item: the MCP server (the hub's own since P129 A4 moved the knowledge tools), the tool and its arguments. */
export const focusRead = z.strictObject({ server: z.enum(["hub"]), tool: z.string(), args: z.record(z.string(), z.union([z.string(), z.number()])) });
export type FocusRead = z.infer<typeof focusRead>;

/** One ref resolved inside the bound project: its title (client data), its status, and the tool that reads it (null: none). */
export const focusItem = z.strictObject({ ref: z.string(), kind: z.enum(REF_KINDS), title: z.string(), status: z.string().nullable(), read: focusRead.nullable() });
export type FocusItem = z.infer<typeof focusItem>;

/** Where "this" came from, in precedence order (P129 verdict 8): the open card, the pointed row, the one selected row, the one row on screen. */
export const THIS_FROM = ["subject", "pointed", "selected", "window"] as const;
export type ThisFrom = (typeof THIS_FROM)[number];

/** What the hook, the `focus` tool and `hub focus --json` return: the focus resolved inside the bound project. */
export const focusDto = z.strictObject({
  state: z.enum(FOCUS_STATES),
  /** What "this" means on his screen, computed by the reader (P129 verdict 8); null: none, or several on screen and none pointed. */
  this: focusItem.nullable(),
  thisFrom: z.enum(THIS_FROM).nullable(),
  project: slug.nullable(),
  ageSeconds: z.number().int().nonnegative().nullable(),
  route: z.string().nullable(),
  title: z.string().nullable(),
  subject: focusItem.nullable(),
  pointed: focusItem.nullable(),
  selected: z.array(focusItem).max(FOCUS_SELECTED_SHOWN),
  /** Selected refs beyond the ones listed (more than 50, gone from this project, or not resolved by the hook). */
  selectedMore: z.number().int().nonnegative(),
  /** The rows on screen; `more`: refs on screen not listed (gone, or not resolved by the hook). */
  window: z.strictObject({ items: z.array(focusItem).max(FOCUS_WINDOW_MAX), total: z.number().int().nonnegative(), more: z.number().int().nonnegative() }).nullable(),
  view: z.record(z.string(), z.string()).nullable(),
  pointer: pointerOutcome.nullable(),
});
export type FocusDto = z.infer<typeof focusDto>;
