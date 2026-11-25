import { z } from "zod";

/**
 * P144 (draft decision 0052): the Watch section's wire shapes. Typed over a generic moment, never over one lens's schema: the
 * routes, the generated client and the endpoint ledger stay static whatever an instance's lens declares.
 */

/** Why a project's watcher reads nothing, or that it reads. */
export const WATCH_STATES = ["invalid", "lens", "off", "no_account", "parked", "polling"] as const;
export type WatchState = (typeof WATCH_STATES)[number];

export const watchStandingDto = z.strictObject({
  state: z.enum(WATCH_STATES),
  /** One line naming the fix (a broken watch.md or lens, the switch, the account), or null while polling. */
  reason: z.string().nullable(),
  /** While parked: until when. */
  until: z.string().nullable(),
});
export type WatchStandingDto = z.infer<typeof watchStandingDto>;

/** `GET /api/watch`: the projects that watch public groups (the section is shown only when one does). */
export const watchProjectsDto = z.strictObject({
  projects: z.array(z.strictObject({ slug: z.string(), lens: z.string().nullable(), standing: watchStandingDto })),
});
export type WatchProjectsDto = z.infer<typeof watchProjectsDto>;

export const WATCH_VIEWS = ["triggers", "topics", "moments", "people", "groups", "trend"] as const;
export type WatchView = (typeof WATCH_VIEWS)[number];

export const watchQuery = z.object({
  /** Days back, 1 to 180 (default 30). */
  days: z.coerce.number().int().min(1).max(180).optional(),
  trigger: z.string().max(64).optional(),
  minIntensity: z.coerce.number().int().min(1).max(5).optional(),
  group: z.string().max(64).optional(),
});

export const GROUP_ACCESS_STATES = ["unknown", "open", "join_required", "pending", "joined", "refused"] as const;

const momentDto = z.strictObject({
  group: z.string(),
  messageId: z.number().int(),
  trigger: z.string(),
  triggerOther: z.string(),
  intensity: z.number().int(),
  quote: z.string(),
  /** The handle, or `user<id>`; null once the author fields are blanked (180 days). */
  author: z.string().nullable(),
  reactors: z.number().int(),
  context: z.string(),
  why: z.string(),
  at: z.string(),
  /** `https://t.me/<group>/<id>`. */
  link: z.string(),
});
export type WatchMomentDto = z.infer<typeof momentDto>;

export const watchDto = z.strictObject({
  slug: z.string(),
  lens: z.strictObject({ id: z.string(), title: z.string() }).nullable(),
  standing: watchStandingDto,
  /** A readable name for each trigger value. */
  labels: z.record(z.string(), z.string()),
  days: z.number().int(),
  spend: z.strictObject({ monthMicroUsd: z.number().int(), budgetMicroUsd: z.number().int() }),
  /** When the next analysis can run: the earliest due time over the groups, or null when nothing waits. */
  nextAnalysis: z.string().nullable(),
  triggers: z.array(z.strictObject({ trigger: z.string(), triggerOther: z.string(), moments: z.number().int(), avgIntensity: z.number(), strong: z.number().int(), daily: z.array(z.number().int()) })),
  topics: z.array(z.strictObject({ topic: z.string(), windows: z.number().int() })),
  moods: z.array(z.strictObject({ group: z.string(), mood: z.string() })),
  moments: z.array(momentDto),
  people: z.array(z.strictObject({ author: z.string(), moments: z.number().int(), intensitySum: z.number().int(), triggers: z.array(z.string()), groups: z.array(z.string()), lastAt: z.string() })),
  groups: z.array(
    z.strictObject({
      username: z.string(),
      title: z.string().nullable(),
      access: z.enum(GROUP_ACCESS_STATES),
      /** The access in the owner's words ("this group must be joined to be read"). */
      accessLine: z.string(),
      perDay: z.number(),
      /** Moments per 100 messages over the period. */
      density: z.number(),
      moments: z.number().int(),
      costMicroUsd: z.number().int(),
      lastPolledAt: z.string().nullable(),
      canJoin: z.boolean(),
    }),
  ),
  trend: z.strictObject({ days: z.array(z.string()), series: z.array(z.strictObject({ trigger: z.string(), counts: z.array(z.number().int()) })) }),
});
export type WatchDto = z.infer<typeof watchDto>;

export const watchJoinParam = z.object({ slug: z.string().min(1), username: z.string().regex(/^[a-z][a-z0-9_]{3,31}$/) });
export const watchJoinDto = z.strictObject({ access: z.enum(["joined", "pending"]) });
export type WatchJoinDto = z.infer<typeof watchJoinDto>;
