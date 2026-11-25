import type { LensDeclaration, LensFacets, LensKit, LensTask, LensTaskSpec } from "@hub/contract/lens";
import { defineTask, type Task, type WindowShape } from "@hub/llm";
import { z } from "zod";

/**
 * The kit a lens module is called with (draft decision 0052): the core's own zod and a `defineTask` whose handle is opaque to the
 * lens. The kit keeps the spec behind each handle it made, so the loader builds the real window task from it and the facets
 * (the speaker index, the reactors, the repeat key), and never trusts an object the module built itself.
 */

/** The watcher's task budget when a lens names none (verdict 6): inside the instance's $5, so it cannot starve the others. */
export const DEFAULT_LENS_BUDGET_USD = 2;

export type WatchTask = Task<z.ZodType, WindowShape>;

export interface Kit extends LensKit {
  /** The spec behind a handle this kit made; undefined for anything else. */
  specOf(handle: LensTask): LensTaskSpec<z.ZodType> | undefined;
}

export function createKit(): Kit {
  const made = new WeakMap<LensTask, LensTaskSpec<z.ZodType>>();
  return {
    z,
    defineTask<S extends z.ZodType>(spec: LensTaskSpec<S>): LensTask {
      const handle: LensTask = Object.freeze({ name: spec.name, version: spec.version });
      made.set(handle, spec);
      return handle;
    },
    lens: (declaration: LensDeclaration): LensDeclaration => declaration,
    specOf: (handle) => made.get(handle),
  };
}

/**
 * The real task: the window shape keyed by the facets, the `window` preset, the `public_chat` source, the lens's budget or the
 * default. `defineTask` walks the schema to its strict form here (the dry run) and refuses fields the shape names that are not
 * there, so a broken lens fails at load, before any request.
 */
export function watchTask(spec: LensTaskSpec<z.ZodType>, facets: LensFacets): WatchTask {
  return defineTask({
    name: spec.name,
    version: spec.version,
    preset: "window",
    schema: spec.schema,
    system: spec.system,
    shape: { kind: "window", size: spec.window.size, overlap: spec.window.overlap, list: spec.window.list, index: facets.speaker, ...(facets.reactors ? { refs: [facets.reactors] } : {}), key: facets.trigger },
    budget: { monthlyUsd: spec.budgetUsd ?? DEFAULT_LENS_BUDGET_USD },
    source: { kind: "public_chat" },
  });
}
