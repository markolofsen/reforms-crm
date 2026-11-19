import { z } from "zod";
import { CORE_LEVELS } from "@hub/config";

/**
 * The instance's brand (P48 W0): `name` and `logo` of `config/config.json`, optional. Without a name the admin says "Hub";
 * without a logo it draws a monogram from the name. The logo file is served by `GET /api/instance/logo` (404 when none),
 * so the browser never learns a path.
 */
export const DEFAULT_INSTANCE_NAME = "Hub";

export const instanceDto = z.strictObject({
  name: z.string().min(1),
  hasLogo: z.boolean(),
  /** P61: the server can run `server` Open actions (macOS with `/usr/bin/open`, or the fake opener). False: those buttons are not rendered. */
  localOpen: z.boolean(),
});
export type InstanceDto = z.infer<typeof instanceDto>;

/**
 * P68: whether the core's origin has a newer version than this instance's pin, read from the server's cache
 * (`GET /api/instance/core`; `POST /api/instance/core/check` runs one check now, 429 within 60 s of the last). The judge is
 * `judgeCoreUpdate` of `@hub/config/core-version`; this is its wire form. `command` names only the instance's own home.
 */
const coreTag = z.strictObject({ name: z.string().regex(/^v\d+\.\d+\.\d+$/), date: z.string().nullable(), subject: z.string() });
export const coreUpdateDto = z.strictObject({
  /** The pin as a person reads it: its tag, else the short commit; null without `core.version`. */
  pin: z.string().nullable(),
  /** The core checked out now (a tag, else the short commit); null before the first check. */
  inUse: z.string().nullable(),
  follows: z.strictObject({ branch: z.string().min(1), behind: z.number().int().nonnegative().nullable() }).optional(),
  newest: z.string().optional(),
  level: z.enum(CORE_LEVELS),
  /** One sentence: why this level. */
  reason: z.string(),
  /** The tags newer than the pin, newest first, at most 10. */
  tags: z.array(coreTag).max(10),
  facts: z.strictObject({ dependencies: z.boolean(), migrations: z.boolean(), rollback: z.boolean() }),
  /** The lines to run in the instance folder, in order; empty when there is nothing to do. */
  command: z.array(z.string()),
  /** The last check that reached the origin. */
  checkedAt: z.string().optional(),
  /** The last check that did not (the rest is the last good answer). */
  error: z.strictObject({ at: z.string(), message: z.string() }).optional(),
});
export type CoreUpdateDto = z.infer<typeof coreUpdateDto>;

/** How soon a second "Check now" is refused (429). */
export const CORE_CHECK_GUARD_MS = 60_000;
