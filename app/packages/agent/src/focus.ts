import { existsSync, readFileSync } from "node:fs";
import { FOCUS_FRESH_MS, FOCUS_SELECTED_SHOWN, FOCUS_TEXT_MAX, focusRecord, type FocusDto, type FocusRecord } from "@hub/contract/focus";
import type { Repos } from "@hub/db";

// The one reader of the shared focus (P51, decision 0029). The hook line (`hub focus --hook`), the `focus` tool of `hub mcp`
// and `hub focus --json` all come from `readFocus`, so they cannot disagree. The file holds ids; names, addresses and
// subjects are read here, inside the bound project only: an id of another project, or a deleted one, drops out.

const cut = (s: string | null | undefined): string => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > FOCUS_TEXT_MAX ? `${t.slice(0, FOCUS_TEXT_MAX - 1)}…` : t;
};

/** `state/focus.json`, parsed; null when missing, unreadable or of an unknown shape. */
export function readFocusFile(file: string): FocusRecord | null {
  try {
    if (!existsSync(file)) return null;
    const r = focusRecord.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const NONE = (slug: string | null): FocusDto => ({ state: "none", project: slug, ageSeconds: null, screen: null, draft: null, client: null, selected: [], selectedMore: 0, view: null, q: null });

/** The focus as the session bound to `slug` may see it. Never throws on a bad file: that is `none`. */
export async function readFocus(o: { file: string; slug: string | undefined; repos: Repos; now?: Date }): Promise<FocusDto> {
  const slug = o.slug ?? null;
  const rec = readFocusFile(o.file);
  if (!rec || !slug) return NONE(slug);
  const f = rec.focus;
  const now = (o.now ?? new Date()).getTime();
  const age = Math.max(0, Math.round((now - Date.parse(rec.at)) / 1000));
  // Another project: say so, name nothing of it.
  if (f.project !== null && f.project !== slug) return { ...NONE(slug), state: "elsewhere", ageSeconds: age, screen: f.screen };
  const stale = !f.visible || now - Date.parse(rec.at) > FOCUS_FRESH_MS;

  const client = async (id: number) => {
    const c = await o.repos.clients.get(slug, id);
    return c ? { id: c.id, name: cut(c.name), email: c.email } : null;
  };
  const draftOf = async (id: number) => {
    const d = await o.repos.drafts.get(id);
    if (!d || d.project !== slug) return null;
    const c = await client(d.clientId);
    return c ? { d, c } : null;
  };

  let draft: FocusDto["draft"] = null;
  if (f.draftId) {
    const x = await draftOf(f.draftId);
    if (x) draft = { id: x.d.id, status: x.d.status, subject: cut(x.d.subject), mailRef: x.d.mailRef, client: x.c };
  }
  const who = draft?.client ?? (f.clientId ? await client(f.clientId) : null);
  const selected: FocusDto["selected"] = [];
  for (const id of f.selected) {
    if (selected.length >= FOCUS_SELECTED_SHOWN) break;
    const x = await draftOf(id);
    if (x) selected.push({ id: x.d.id, name: x.c.name, email: x.c.email, subject: cut(x.d.subject), status: x.d.status });
  }
  return {
    state: stale ? "stale" : "fresh",
    project: slug,
    ageSeconds: age,
    screen: f.screen,
    draft,
    client: who,
    selected,
    selectedMore: f.selected.length - selected.length,
    view: f.view ?? null,
    q: f.q ? cut(f.q) : null,
  };
}

const ago = (s: number | null): string => (s === null ? "" : s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`);
const SCREEN_WORDS: Record<string, string> = { drafts: "the Drafts list", draft: "a draft", activity: "Activity", run: "a run", "follow-ups": "Follow-ups", project: "Project", connections: "Connections", overview: "Overview", other: "another page" };

/**
 * The one line the prompt hook adds (Claude `UserPromptSubmit`, Codex the same event): only for `fresh` and `elsewhere`,
 * nothing otherwise (a stale focus must not steer a reply). Labelled as data: names and subjects are client text.
 */
export function focusLine(f: FocusDto): string | null {
  if (f.state === "elsewhere") return `[Hub focus, data] the admin shows another project, not ${f.project ?? "this one"}; this session is bound to ${f.project ?? "no project"}.`;
  if (f.state !== "fresh") return null;
  const parts: string[] = [];
  if (f.draft) parts.push(`draft ${f.draft.id} · ${f.draft.client.name || f.draft.client.email} <${f.draft.client.email}> · ${f.draft.subject} · ${f.draft.status}`);
  else if (f.client) parts.push(`client ${f.client.id} · ${f.client.name || f.client.email} <${f.client.email}>`);
  else parts.push(SCREEN_WORDS[f.screen ?? "other"] ?? "another page");
  if (f.selected.length) parts.push(`selected ${f.selected.length + f.selectedMore}: drafts ${f.selected.map((s) => s.id).join(", ")}${f.selectedMore ? ", ..." : ""}`);
  if (f.view && !f.draft) parts.push(`view ${f.view}${f.q ? `, search "${f.q}"` : ""}`);
  return `[Hub focus, data] ${parts.join(" · ")} · ${ago(f.ageSeconds)} (call the hub focus tool for detail)`;
}
