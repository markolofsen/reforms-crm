// A knowledge entry: markdown with YAML front matter (doc 16 section 5). The fields mirror the Notion Knowledge
// database, so an import is a mapping, not an interpretation.
import { createHash } from "node:crypto";
import { parse, stringify } from "yaml";

export type Use = "STATE" | "MARKER";

export interface FrontMatter {
  title: string;
  approved: boolean;
  use: Use;
  audiences: string[];
  category?: string;
  kind?: string;
  stages?: string[];
  folder?: string;
  phrasings?: string[];
  valid_until?: string;
  last_confirmed?: string;
  source?: string;
  supersedes?: string;
  notion_id?: string;
  notion_edited?: string;
}

export interface Entry {
  front: FrontMatter;
  body: string;
}

export class EntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntryError";
  }
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const AUDIENCE = /^[A-Z][A-Z0-9_]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;
const KEY_ORDER = [
  "title",
  "approved",
  "use",
  "audiences",
  "category",
  "kind",
  "stages",
  "folder",
  "phrasings",
  "valid_until",
  "last_confirmed",
  "source",
  "supersedes",
  "notion_id",
  "notion_edited",
] as const;

export function splitFrontMatter(text: string): { data: unknown; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text.replace(/^﻿/, ""));
  if (!m) return null;
  return { data: parse(m[1] ?? "") as unknown, body: text.replace(/^﻿/, "").slice(m[0].length) };
}

const str = (v: unknown, field: string, optional = true): string | undefined => {
  if (v === undefined || v === null || v === "") {
    if (!optional) throw new EntryError(`${field} is required`);
    return undefined;
  }
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  throw new EntryError(`${field} must be text`);
};

const strList = (v: unknown, field: string): string[] | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const items = typeof v === "string" ? v.split("|") : Array.isArray(v) ? v : null;
  if (!items) throw new EntryError(`${field} must be a list`);
  const out = items.map((x) => (typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : null));
  if (out.some((x) => x === null)) throw new EntryError(`${field} must be a list of text`);
  return (out as string[]).filter(Boolean);
};

const date = (v: unknown, field: string): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.trim() : null;
  if (s === null || !DATE.test(s)) throw new EntryError(`${field} must be an ISO date (YYYY-MM-DD)`);
  return s;
};

/** Validates parsed front matter and applies the defaults of doc 16: approved true, use STATE, audiences empty. */
export function normalizeFront(data: unknown): FrontMatter {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new EntryError("front matter must be a mapping");
  const d = data as Record<string, unknown>;
  const title = str(d.title, "title", false) as string;

  const approvedRaw = d.approved ?? true;
  if (typeof approvedRaw !== "boolean") throw new EntryError("approved must be true or false");
  const useRaw = d.use ?? "STATE";
  if (useRaw !== "STATE" && useRaw !== "MARKER") throw new EntryError(`use must be STATE or MARKER, got "${String(useRaw)}"`);
  const audiences = strList(d.audiences, "audiences") ?? [];
  const badAudience = audiences.find((a) => !AUDIENCE.test(a));
  if (badAudience) throw new EntryError(`audience "${badAudience}" must be UPPER_SNAKE_CASE`);

  const front: FrontMatter = { title, approved: approvedRaw, use: useRaw, audiences };
  const set = <K extends keyof FrontMatter>(k: K, v: FrontMatter[K] | undefined) => {
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) front[k] = v;
  };
  set("category", str(d.category, "category"));
  set("kind", str(d.kind, "kind"));
  set("stages", strList(d.stages, "stages"));
  set("folder", str(d.folder, "folder"));
  set("phrasings", strList(d.phrasings, "phrasings"));
  set("valid_until", date(d.valid_until, "valid_until"));
  set("last_confirmed", date(d.last_confirmed, "last_confirmed"));
  set("source", str(d.source, "source"));
  set("supersedes", str(d.supersedes, "supersedes"));
  set("notion_id", str(d.notion_id, "notion_id"));
  set("notion_edited", str(d.notion_edited, "notion_edited"));
  return front;
}

/** Parses one entry file. Throws EntryError naming what is wrong. */
export function parseEntry(text: string): Entry {
  let split: ReturnType<typeof splitFrontMatter>;
  try {
    split = splitFrontMatter(text);
  } catch (err) {
    throw new EntryError(`front matter is not valid YAML: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
  if (!split) throw new EntryError("no front matter (the file must start with --- and a title)");
  return { front: normalizeFront(split.data), body: split.body.replace(/^\r?\n+/, "").replace(/\s+$/, "") };
}

/** The canonical file text: fixed key order, empty fields omitted, one blank line before the body. Same input, same bytes. */
export function renderEntry(front: FrontMatter, body: string): string {
  const ordered: Record<string, unknown> = {};
  for (const k of KEY_ORDER) {
    const v = front[k];
    if (v !== undefined) ordered[k] = v;
  }
  return `---\n${stringify(ordered, { lineWidth: 0 })}---\n\n${body.replace(/\s+$/, "")}\n`;
}
