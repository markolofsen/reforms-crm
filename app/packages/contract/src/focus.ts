import { DRAFT_VIEWS } from "@hub/config";
import { z } from "zod";

// The shared focus (P51, decision 0029): what the owner's admin tab shows, published to the server so the agent in the
// dock can resolve "this client", "this draft", "the selected ones". Ids only: names, addresses and subjects are read from
// the database at read time, inside the bound project. Every object is strict: an unknown field is refused.

/** The screens a focus can name. `other` covers a route the publisher does not map (Not found). */
export const FOCUS_SCREENS = ["drafts", "draft", "activity", "run", "follow-ups", "project", "connections", "overview", "other"] as const;
export type FocusScreen = (typeof FOCUS_SCREENS)[number];

/** At most this many selected draft ids are published; the reader names at most {@link FOCUS_SELECTED_SHOWN}. */
export const FOCUS_SELECTED_MAX = 200;
export const FOCUS_SELECTED_SHOWN = 50;
/** A visible focus older than this is stale; the publisher re-posts every {@link FOCUS_HEARTBEAT_MS} while visible. */
export const FOCUS_FRESH_MS = 10 * 60_000;
export const FOCUS_HEARTBEAT_MS = 60_000;
/** Names and subjects in a focus reply are cut to this many characters (client data, labelled as data). */
export const FOCUS_TEXT_MAX = 120;

const slug = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(100);
const id = z.number().int().positive();
const tab = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);

/** `POST /api/focus`: one tab's focus, or that tab's clear (its `pagehide`). The server adds the time. */
export const focusInput = z.union([
  z.strictObject({
    tab,
    project: slug.nullable(),
    screen: z.enum(FOCUS_SCREENS),
    draftId: id.optional(),
    clientId: id.optional(),
    runId: id.optional(),
    selected: z.array(id).max(FOCUS_SELECTED_MAX),
    view: z.enum(DRAFT_VIEWS).optional(),
    q: z.string().max(200).optional(),
    visible: z.boolean(),
  }),
  z.strictObject({ tab, clear: z.literal(true) }),
]);
export type FocusInput = z.infer<typeof focusInput>;
export type FocusPost = Extract<FocusInput, { screen: FocusScreen }>;

/** What `state/focus.json` holds: the last post that counts, stamped with the server's clock. */
export const focusRecord = z.strictObject({ schema: z.literal(1), at: z.string(), focus: focusInput.options[0] });
export type FocusRecord = z.infer<typeof focusRecord>;

/**
 * `fresh`: the owner's visible tab, at most 10 minutes old, on the bound project. `stale`: hidden or older. `elsewhere`: the
 * admin shows another project (named nowhere). `none`: no admin focus at all (no file, cleared).
 */
export const FOCUS_STATES = ["fresh", "stale", "elsewhere", "none"] as const;
export type FocusState = (typeof FOCUS_STATES)[number];

const person = z.strictObject({ id, name: z.string(), email: z.string() });
export const focusDraft = z.strictObject({ id, status: z.string(), subject: z.string(), mailRef: z.string().nullable(), client: person });
export const focusRow = z.strictObject({ id, name: z.string(), email: z.string(), subject: z.string(), status: z.string() });

/** What the hook, the `focus` tool and `hub focus --json` return: the focus resolved inside the bound project. */
export const focusDto = z.strictObject({
  state: z.enum(FOCUS_STATES),
  project: slug.nullable(),
  ageSeconds: z.number().int().nonnegative().nullable(),
  screen: z.enum(FOCUS_SCREENS).nullable(),
  draft: focusDraft.nullable(),
  client: person.nullable(),
  selected: z.array(focusRow).max(FOCUS_SELECTED_SHOWN),
  /** Selected ids beyond the ones listed (more than 50, or gone from this project). */
  selectedMore: z.number().int().nonnegative(),
  view: z.enum(DRAFT_VIEWS).nullable(),
  q: z.string().nullable(),
});
export type FocusDto = z.infer<typeof focusDto>;
