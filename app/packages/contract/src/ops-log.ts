import { z } from "zod";
import { STATUS_NEXT } from "./overview";

// P86: Overview's "Recent errors", the newest `error` lines of the ops log (`@hub/log/ops`, `@docs/core/28-ops-log.md`).
// Each row names the part it is about (`source`), when, the redacted message, and the place that fixes it (a place of
// `statusDto.next`, the same words as a part's `place`); the server maps a source to its place, so the admin needs no list.

/** How far back Overview looks, and how many rows it shows. */
export const RECENT_ERRORS_HOURS = 24;
export const RECENT_ERRORS_LIMIT = 5;

export const opsErrorRow = z.strictObject({
  time: z.string(),
  source: z.string().min(1).max(40),
  message: z.string().max(600),
  place: z.enum(STATUS_NEXT).nullable(),
  /** The project the line names (its `project` field), for a place inside a project; null: the open one. */
  project: z.string().min(1).max(100).nullable(),
});
export type OpsErrorRowDto = z.infer<typeof opsErrorRow>;

export const opsErrorsDto = z.strictObject({
  /** Newest first, at most `RECENT_ERRORS_LIMIT`. */
  rows: z.array(opsErrorRow).max(50),
  /** Every error line of the window, shown or not. */
  total: z.number().int().nonnegative(),
  hours: z.number().int().positive(),
});
export type OpsErrorsDto = z.infer<typeof opsErrorsDto>;
