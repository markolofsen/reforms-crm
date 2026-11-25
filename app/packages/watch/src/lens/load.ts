import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { lensDataSchema, type LensData, type LensFacets, type LensTask, type LensWindowFacets } from "@hub/contract/lens";
import { z } from "zod";
import { createKit, watchTask, type WatchTask } from "./kit";

/**
 * Finding and checking a lens (draft decision 0052). The core never imports an instance package by specifier (decision 0018
 * rule 3): the watch domain `import()`s `<home>/packages/<name>/src/index.ts` by file URL, only from there, calls its default
 * export with the kit, and validates what comes back: the declaration's shape, the strict walk of the task's schema (the dry run)
 * and facets that name real fields of the right kind. A lens that fails parks its project's watcher with the reason; the server
 * runs on. `hub doctor`'s `watch.lens` runs the same check offline.
 */

export interface LoadedLens {
  id: string;
  title: string;
  task: WatchTask;
  facets: LensFacets;
  window: LensWindowFacets;
  labels: Record<string, string>;
  /** The trigger field's values, in the schema's order. */
  triggers: string[];
}

export type LensLoad = { ok: true; lens: LoadedLens } | { ok: false; reason: string };

/** A lens module's default export, kept so a changed `lens.json` is declared again without a new import (P153, D2). */
export type LensModuleFn = (kit: unknown) => unknown;

/** A loaded lens with what a live reload needs: the module, and the stamps of its data file and its code. */
export type LensLoadFull = { ok: true; lens: LoadedLens; module: LensModuleFn; dataStamp: number; codeStamp: number } | { ok: false; reason: string };

/** `<packages>/<name>/lens.json` beside `src/`, or null for a name that is not a plain package folder. */
export function lensDataFile(instancePackages: string, name: string): string | null {
  const code = lensFile(instancePackages, name);
  return code ? resolve(code, "..", "..", "lens.json") : null;
}

/** A file's modification time in ms, or 0 when it is missing. */
export const stampOf = (file: string | null): number => {
  if (!file) return 0;
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/** The lens's `lens.json`, checked; the reason names the field when it is not one. */
export function readLensData(instancePackages: string, name: string): { ok: true; data: LensData } | { ok: false; reason: string } {
  const file = lensDataFile(instancePackages, name);
  if (!file) return { ok: false, reason: `"${name}" is not a lens package name (lower case, digits and "-")` };
  if (!existsSync(file)) return { ok: false, reason: `no lens data at ${join("packages", name, "lens.json")}` };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { ok: false, reason: `lens.json is not JSON: ${e instanceof Error ? e.message.slice(0, 160) : "unknown error"}` };
  }
  const d = lensDataSchema.safeParse(raw);
  if (!d.success) return { ok: false, reason: `lens.json: ${d.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` };
  return { ok: true, data: d.data };
}

/** A lens package's folder name: a plain name, so no `..` or path ever leaves `<home>/packages`. */
export const LENS_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** `<packages>/<name>/src/index.ts`, or null for a name that is not a plain package folder. */
export function lensFile(instancePackages: string, name: string): string | null {
  if (!LENS_NAME.test(name)) return null;
  const root = resolve(instancePackages);
  const file = resolve(root, name, "src", "index.ts");
  return file.startsWith(root + sep) ? file : null;
}

const Facets = z.strictObject({
  trigger: z.string(),
  triggerOther: z.string().optional(),
  intensity: z.string(),
  quote: z.string(),
  speaker: z.string(),
  reactors: z.string().optional(),
  context: z.string().optional(),
  why: z.string().optional(),
  keep: z.array(z.strictObject({ field: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) })).optional(),
});
const Declaration = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "a lower-case id"),
  title: z.string().trim().min(1).max(80),
  task: z.object({ name: z.string(), version: z.number() }),
  facets: Facets,
  window: z.strictObject({ topics: z.string().optional(), mood: z.string().optional() }).optional(),
  labels: z.record(z.string(), z.string()),
});

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);
const isHandle = (v: unknown): v is LensTask => isNode(v) && typeof v.name === "string" && typeof v.version === "number";
const typeOf = (n: unknown): string => (isNode(n) && typeof n.type === "string" ? n.type : isNode(n) && Array.isArray(n.enum) ? "enum" : "?");

/** Each facet names a field of the moment entry with the kind it needs; returns the first problem, or null. */
function facetProblem(entry: Node, root: Node, f: LensFacets, w: LensWindowFacets): string | null {
  const need: Array<[string | undefined, (n: unknown) => boolean, string]> = [
    [f.trigger, (n) => isNode(n) && Array.isArray(n.enum), "an enum"],
    [f.triggerOther, (n) => typeOf(n) === "string", "a string"],
    [f.intensity, (n) => typeOf(n) === "integer" || typeOf(n) === "number", "a number"],
    [f.quote, (n) => typeOf(n) === "string", "a string"],
    [f.speaker, (n) => typeOf(n) === "integer", "an integer"],
    [f.reactors, (n) => isNode(n) && n.type === "array" && typeOf(n.items) === "integer", "a list of integers"],
    [f.context, (n) => typeOf(n) === "string", "a string"],
    [f.why, (n) => typeOf(n) === "string", "a string"],
  ];
  for (const [name, ok, what] of need) {
    if (name === undefined) continue;
    if (!(name in entry)) return `facet field "${name}" is not a field of a moment`;
    if (!ok(entry[name])) return `facet field "${name}" must be ${what}`;
  }
  for (const k of f.keep ?? []) if (!(k.field in entry)) return `keep field "${k.field}" is not a field of a moment`;
  if (w.topics !== undefined && typeOf(root[w.topics]) !== "array") return `window field "${w.topics}" must be a list of the answer`;
  if (w.mood !== undefined && typeOf(root[w.mood]) !== "string") return `window field "${w.mood}" must be a string of the answer`;
  return null;
}

/** The lens a module's default export declares, checked. Pure: tests call it with a module function directly. */
export function checkLens(mod: unknown, data: LensData): LensLoad {
  if (typeof mod !== "function") return { ok: false, reason: "the lens module has no default export function (export default (kit) => kit.lens({ … }))" };
  const kit = createKit(data);
  let declared: unknown;
  try {
    declared = mod(kit);
  } catch (e) {
    return { ok: false, reason: `the lens threw while declaring: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` };
  }
  const d = Declaration.safeParse(declared);
  if (!d.success) return { ok: false, reason: `the declaration is not a lens: ${d.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` };
  // The handle itself (zod's parse returns a copy): the kit knows it by identity.
  const handle = isNode(declared) ? declared.task : undefined;
  const spec = isHandle(handle) ? kit.specOf(handle) : undefined;
  if (!spec) return { ok: false, reason: "the task was not made by kit.defineTask" };
  let task: WatchTask;
  try {
    task = watchTask(spec, d.data.facets);
  } catch (e) {
    return { ok: false, reason: `the task cannot be sent: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` };
  }
  const props = isNode(task.wire.properties) ? task.wire.properties : {};
  const list = props[spec.window.list];
  const entry = isNode(list) && isNode(list.items) && isNode(list.items.properties) ? list.items.properties : {};
  const problem = facetProblem(entry, props, d.data.facets, d.data.window ?? {});
  if (problem) return { ok: false, reason: problem };
  const trig = entry[d.data.facets.trigger];
  const triggers = isNode(trig) && Array.isArray(trig.enum) ? trig.enum.filter((v): v is string => typeof v === "string") : [];
  return { ok: true, lens: { id: d.data.id, title: d.data.title, task, facets: d.data.facets, window: d.data.window ?? {}, labels: d.data.labels, triggers } };
}

/** The module's default export; a CommonJS-scoped lens arrives as `{ default: { default } }`. */
const defaultOf = (mod: unknown): unknown => {
  const d = isNode(mod) ? mod.default : undefined;
  return isNode(d) && typeof d.default === "function" ? d.default : d;
};

/**
 * Loads `<packages>/<name>/src/index.ts` by file URL with its `lens.json`, and checks both. Never throws: a failure is the
 * reason the watcher parks.
 */
export async function loadLensFull(instancePackages: string, name: string): Promise<LensLoadFull> {
  const file = lensFile(instancePackages, name);
  if (!file) return { ok: false, reason: `"${name}" is not a lens package name (lower case, digits and "-")` };
  if (!existsSync(file)) return { ok: false, reason: `no lens at ${join("packages", name, "src", "index.ts")}` };
  const data = readLensData(instancePackages, name);
  if (!data.ok) return data;
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (e) {
    return { ok: false, reason: `the lens did not load: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` };
  }
  const fn = defaultOf(mod);
  const r = checkLens(fn, data.data);
  if (!r.ok || typeof fn !== "function") return r.ok ? { ok: false, reason: "the lens module has no default export function" } : r;
  return { ok: true, lens: r.lens, module: (kit) => fn(kit), dataStamp: stampOf(lensDataFile(instancePackages, name)), codeStamp: stampOf(file) };
}

/** `loadLensFull` without the reload parts (the doctor, the import). */
export async function loadLens(instancePackages: string, name: string): Promise<LensLoad> {
  const r = await loadLensFull(instancePackages, name);
  return r.ok ? { ok: true, lens: r.lens } : r;
}

/** A changed `lens.json` declared again with the module already imported (its code is not read again). */
export function redeclareLens(module: LensModuleFn, instancePackages: string, name: string): LensLoad {
  const data = readLensData(instancePackages, name);
  return data.ok ? checkLens(module, data.data) : data;
}
