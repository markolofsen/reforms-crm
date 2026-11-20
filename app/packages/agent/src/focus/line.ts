import { FOCUS_LINE_MAX, type FocusDto, type FocusItem } from "@hub/contract/focus";

// The one line the prompt hook adds (Claude `UserPromptSubmit`, Codex the same event; P51, P72). Generic over every route:
// the screen's title, then what is open or pointed by ref, title and read tool, then counts. Only for `fresh` and
// `elsewhere`, nothing otherwise (a stale focus must not steer a reply). Labelled as data: titles are client text.

const ago = (s: number | null): string => (s === null ? "" : s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`);
const TAIL = " (call the hub focus tool for detail)";

const itemText = (verb: string, it: FocusItem): string => `${verb} ${it.ref} "${it.title}"${it.status ? ` ${it.status}` : ""}${it.read ? ` (${it.read.tool})` : ""}`;

export function focusLine(f: FocusDto): string | null {
  if (f.state === "elsewhere") return `[Hub focus, data] the admin shows another project, not ${f.project ?? "this one"}; this session is bound to ${f.project ?? "no project"}.`;
  if (f.state !== "fresh") return null;
  const parts: string[] = [f.title ?? "the admin"];
  if (f.subject) parts.push(itemText("open", f.subject));
  if (f.pointed) parts.push(itemText("on", f.pointed));
  const picked = f.selected.length + f.selectedMore;
  if (picked) parts.push(`${picked} selected`);
  if (f.window && f.window.total) parts.push(`${f.window.items.length + f.window.more} of ${f.window.total} on screen`);
  if (f.view?.q) parts.push(`search "${f.view.q}"`);
  if (f.view?.filter) parts.push(`view ${f.view.filter}`);
  const body = `[Hub focus, data] ${parts.join(" · ")} · ${ago(f.ageSeconds)}`;
  const room = FOCUS_LINE_MAX - TAIL.length;
  return `${body.length > room ? `${body.slice(0, room - 1)}…` : body}${TAIL}`;
}
