import type { z } from "zod";

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
 */

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
  defineTask<S extends z.ZodType>(spec: LensTaskSpec<S>): LensTask;
  lens(declaration: LensDeclaration): LensDeclaration;
}

/** The default export of a lens module. */
export type LensModule = (kit: LensKit) => LensDeclaration;
