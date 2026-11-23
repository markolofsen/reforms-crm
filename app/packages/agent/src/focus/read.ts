import { existsSync, readFileSync } from "node:fs";
import { FOCUS_FRESH_MS, FOCUS_SELECTED_SHOWN, focusRecord, type FocusDto, type FocusItem, type FocusRecord } from "@hub/contract/focus";
import type { Repos } from "@hub/db";
import { cut } from "../mcp/result";
import { resolveRef, type ResolveCtx } from "./resolvers";

// The one reader of the shared focus (P51, decision 0029; P72, decision 0038). The hook line (`hub focus --hook`), the
// `focus` tool of `hub mcp` and `hub focus --json` all come from `readFocus`, so they cannot disagree. The file holds the
// route, its title and refs; every title, name and status is read here, inside the bound project only, by one resolver per
// ref kind (`resolvers/`): a ref of another project, or a deleted one, drops out. `depth: "line"` (the prompt hook, under its
// 5 s timeout) resolves the subject and the pointed row only and counts the rest; `full` (the tool) resolves everything.

/** `state/focus.json`, parsed; null when missing, unreadable or of another shape (a `schema: 1` file too). */
export function readFocusFile(file: string): FocusRecord | null {
  try {
    if (!existsSync(file)) return null;
    const r = focusRecord.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const NONE = (slug: string | null): FocusDto => ({ state: "none", project: slug, ageSeconds: null, route: null, title: null, subject: null, pointed: null, selected: [], selectedMore: 0, window: null, view: null, pointer: null });

/** Each ref resolved in order, at most `max` listed. */
async function resolveAll(ctx: ResolveCtx, refs: readonly string[], max: number): Promise<FocusItem[]> {
  const out: FocusItem[] = [];
  for (const ref of refs) {
    if (out.length >= max) break;
    const it = await resolveRef(ctx, ref);
    if (it) out.push(it);
  }
  return out;
}

export type FocusDepth = "line" | "full";

/** The focus as the session bound to `slug` may see it. Never throws on a bad file: that is `none`. */
export async function readFocus(o: { file: string; slug: string | undefined; repos: Repos; now?: Date; depth?: FocusDepth }): Promise<FocusDto> {
  const slug = o.slug ?? null;
  const rec = readFocusFile(o.file);
  if (!rec || !slug) return NONE(slug);
  const f = rec.focus;
  const nowDate = o.now ?? new Date();
  const now = nowDate.getTime();
  const age = Math.max(0, Math.round((now - Date.parse(rec.at)) / 1000));
  // Another project: say so, name nothing of it (not even its route's refs).
  if (f.project !== null && f.project !== slug) return { ...NONE(slug), state: "elsewhere", ageSeconds: age, route: f.route, title: f.title };
  const stale = !f.visible || now - Date.parse(rec.at) > FOCUS_FRESH_MS;
  const full = (o.depth ?? "full") === "full";
  const ctx: ResolveCtx = { repos: o.repos, slug, today: nowDate.toISOString().slice(0, 10) };

  const subject = f.subject ? await resolveRef(ctx, f.subject) : null;
  const pointed = f.pointed && f.pointed !== f.subject ? await resolveRef(ctx, f.pointed) : null;
  const selected = full ? await resolveAll(ctx, f.selected, FOCUS_SELECTED_SHOWN) : [];
  const windowItems = full && f.window ? await resolveAll(ctx, f.window.refs, f.window.refs.length) : [];
  const view = f.view ? Object.fromEntries(Object.entries(f.view).map(([k, v]) => [k, cut(v)])) : null;
  return {
    state: stale ? "stale" : "fresh",
    project: slug,
    ageSeconds: age,
    route: f.route,
    title: f.title,
    subject,
    pointed,
    selected,
    selectedMore: f.selected.length - selected.length,
    window: f.window ? { items: windowItems, total: f.window.total, more: f.window.refs.length - windowItems.length } : null,
    view: view && Object.keys(view).length ? view : null,
    pointer: f.pointer ?? null,
  };
}
