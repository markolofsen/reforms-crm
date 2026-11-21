import { z } from "zod";
import { agentRef, SLUG } from "./refs";

// The agent's pointer (P72, decision 0038): the `highlight` tool of `hub mcp` names up to five refs on the owner's screen and
// a short note; the admin draws a ring on those rows. A pointer, never an action: nothing on the page changes but the ring.
// `hub mcp` writes `state/pointer.json` and bumps the live topic `pointer`; the admin reads `GET /api/pointer`. The admin
// never writes the pointer; the agent never writes the focus. The outcome comes back once, in the next focus post.

/** At most this many refs per highlight; the note is at most {@link POINTER_NOTE_MAX} characters, shown as text. */
export const POINTER_MAX_REFS = 5;
export const POINTER_NOTE_MAX = 80;
/** A highlight expires this long after the agent made it. */
export const POINTER_TTL_MS = 30_000;
/** The ring waits at most this long for its row to be visible before it reports `not-on-screen`. */
export const POINTER_WAIT_MS = 800;

/** `shown`: the ring was drawn. `not-on-screen`: no row of it on this route. `dismissed`: Escape, a click or a route change. `expired`: 30 s. */
export const POINTER_OUTCOMES = ["shown", "not-on-screen", "dismissed", "expired"] as const;
export type PointerOutcome = (typeof POINTER_OUTCOMES)[number];

export const pointerId = z.string().regex(/^[A-Za-z0-9]{8,32}$/);

/** What `state/pointer.json` holds (mode 600): refs and ids only, never a title. `refs: []` is a clear. */
export const pointerRecord = z.strictObject({
  schema: z.literal(1),
  id: pointerId,
  project: z.string().regex(SLUG).max(100),
  refs: z.array(agentRef).max(POINTER_MAX_REFS),
  note: z.string().max(POINTER_NOTE_MAX).nullable(),
  at: z.string(),
});
export type PointerRecord = z.infer<typeof pointerRecord>;

/**
 * One pointed ref as `GET /api/pointer` returns it: its title resolved inside the project (null: it names nothing there), and
 * `where`, the ref of the screen it lives on when that is not its own (P99: a draft and a message of theirs live in their
 * client's conversation, `client:<id>`), so Show opens that conversation; null: the ref's own screen.
 */
export const pointerTarget = z.strictObject({ ref: agentRef, title: z.string().nullable(), where: agentRef.nullable() });

/** `GET /api/pointer`: the live pointer, or null (none, cleared, expired). */
export const pointerDto = z.strictObject({
  pointer: z
    .strictObject({ id: pointerId, project: z.string(), targets: z.array(pointerTarget).max(POINTER_MAX_REFS), note: z.string().max(POINTER_NOTE_MAX).nullable(), expiresAt: z.string() })
    .nullable(),
});
export type PointerDto = z.infer<typeof pointerDto>;
export type LivePointer = NonNullable<PointerDto["pointer"]>;
