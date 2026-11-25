import { z } from "zod";

/**
 * A watch lens (P144, draft decision 0052): the one thing an instance supplies to the public-chat watcher. A lens is a declaration
 * with no routes and no UI: a window task (the schema the model fills about one stretch of a public conversation, its prompt and
 * its budget), the facets (which schema fields are the trigger, the intensity, the quote, the speaker, and so on) and readable
 * labels. All the machinery (the reader, the store, the job, the routes and the Watch page) is the core's.
 *
 * An instance writes `<home>/packages/<lens>/src/index.ts`:
 *
 * ```ts
 * import type { LensKit } from "@hub/contract/lens";
 * export default (kit: LensKit) => kit.lens({ id, title, task: kit.defineTask({ … }), facets, labels });
 * ```
 *
 * It needs only this `import type`: `kit.z` is the core's own zod and `kit.defineTask` the core's, so the module has no runtime
 * dependency and nothing is installed at the instance root.
 *
 * P153 (plan D2): what the owner or his session changes often lives beside the code in `<home>/packages/<lens>/lens.json`:
 * the version, the title, the prompt, the triggers with their labels and meanings, the keep rule, the window and the budget.
 * The core reads and checks it (`lensDataSchema`) and hands it to the module as `kit.data`. A change to `lens.json` (or to the
 * project's `watch.md`) is loaded while the server runs; a change to the module's code waits for a restart (Node keeps a module
 * it imported), and the Watch page says so.
 */

const keepSchema = z.strictObject({ field: z.string().min(1), equals: z.union([z.string(), z.number(), z.boolean()]) });

/** The cross-author script rule (`LensScripts`), checked. */
export const scriptsSchema = z.strictObject({
  rules: z.array(z.strictObject({ words: z.number().int().min(3).max(12), authors: z.number().int().min(2).max(20) })).min(1).max(5),
  distinct: z.number().int().min(1).max(12).optional(),
  common: z.array(z.string().trim().min(1).max(40)).max(2_000),
});

/** `lens.json`: the editable half of a lens. */
export const lensDataSchema = z.strictObject({
  /** Bumped when the prompt or the triggers change meaning; stored beside every window read with it. Old windows stay. */
  version: z.number().int().min(1),
  title: z.string().trim().min(1).max(80),
  /** The task's fixed system text. */
  prompt: z.string().trim().min(1).max(20_000),
  /** The trigger values in order (the schema's enum), each with its readable label and, optionally, what it means to the model. */
  triggers: z
    .array(z.strictObject({ value: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "a snake_case value"), label: z.string().trim().min(1).max(80), means: z.string().trim().min(1).max(400).optional() }))
    .min(2)
    .max(30)
    .refine((t) => new Set(t.map((x) => x.value)).size === t.length, "trigger values must be unique"),
  /** One more sentence for the model after the triggers' meanings (what goes to `other`, say). */
  triggerNote: z.string().trim().max(1_000).optional(),
  keep: z.array(keepSchema).max(10).optional(),
  /** Drops the moments of authors who share a script with others in the group (P144 W5): the lens's thresholds and common words. */
  scripts: scriptsSchema.optional(),
  window: z.strictObject({ size: z.number().int().min(10).max(200), overlap: z.number().int().min(0).max(100) }).optional(),
  /** The task's monthly budget in dollars, inside the instance cap; $2 when left out. */
  budgetUsd: z.number().positive().max(5).optional(),
});
export type LensData = z.infer<typeof lensDataSchema>;

/** The window a lens's task reads: `size` messages, `overlap` shared with the next window. */
export interface LensWindow {
  size: number;
  overlap: number;
  /** The answer's list of moments (a field of the schema's root). */
  list: string;
}

export interface LensTaskSpec<S extends z.ZodType> {
  /** The ledger's name of the task, e.g. `watch.<lens id>`. */
  name: string;
  /** Bumped when the prompt or the schema changes meaning; stored beside every window it read. */
  version: number;
  schema: S;
  /** The fixed system text: what the product is, who the people are, what a moment is. */
  system: string;
  window: LensWindow;
  /** The task's monthly budget inside the instance cap; $2 when left out. */
  budgetUsd?: number;
}

/** What `kit.defineTask` returns: opaque to the lens, checked and run by the core. */
export interface LensTask {
  readonly name: string;
  readonly version: number;
}

/** A keep-filter condition: the moment is kept only when `field` equals `equals` (all conditions must hold). */
export interface LensKeep {
  field: string;
  equals: string | number | boolean;
}

/**
 * The cross-author script rule (P144 W5, the experiment's `shill.py`): for each rule, a sequence of `words` words that at least
 * `authors` different authors of one group used marks every one of them, and their moments are dropped. A sequence counts only
 * with at least `distinct` words (3 when left out) outside `common`, the lens's very common words in its languages.
 */
export interface LensScripts {
  rules: Array<{ words: number; authors: number }>;
  distinct?: number;
  common: string[];
}

/** Which fields of one moment (an entry of `window.list`) mean what. Every name must be a real field of the entry. */
export interface LensFacets {
  /** The trigger: an enum field. */
  trigger: string;
  /** Free text that names the trigger when it is the enum's `other` value. */
  triggerOther?: string;
  /** A whole number, higher is stronger (1 to 5). */
  intensity: string;
  /** The person's words, verbatim. */
  quote: string;
  /** The `[n]` of the message where the trigger is voiced. */
  speaker: string;
  /** A list of `[n]` of messages that react to it. */
  reactors?: string;
  /** One line on the thread around it. */
  context?: string;
  /** Why it fits what the owner offers. */
  why?: string;
  keep?: LensKeep[];
  /** Authors who post a shared script lose their moments (see {@link LensScripts}). */
  scripts?: LensScripts;
}

/** Window-level fields shown on the Watch page: topics (a list of strings) and the mood (a string). */
export interface LensWindowFacets {
  topics?: string;
  mood?: string;
}

export interface LensDeclaration {
  /** Lower-case id, e.g. `crypto`. */
  id: string;
  /** The Watch page's heading for this lens. */
  title: string;
  task: LensTask;
  facets: LensFacets;
  window?: LensWindowFacets;
  /** A readable name for each trigger value; a value with no label shows as itself. */
  labels: Record<string, string>;
}

/** What a lens module receives. */
export interface LensKit {
  readonly z: typeof z;
  /** The lens's `lens.json`, checked. */
  readonly data: LensData;
  defineTask<S extends z.ZodType>(spec: LensTaskSpec<S>): LensTask;
  lens(declaration: LensDeclaration): LensDeclaration;
}

/** The default export of a lens module. */
export type LensModule = (kit: LensKit) => LensDeclaration;
