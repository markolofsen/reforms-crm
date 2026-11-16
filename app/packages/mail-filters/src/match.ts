import type { Match, MatchKind } from "./model.js";

// Gmail filter criteria limits. Gmail documents no exact number for a criteria field; these are deliberately
// conservative so an import never gets refused: one value, and one merged query per filter.
export const MAX_VALUE_LEN = 120;
export const MAX_SUBJECT_LEN = 100;
export const MAX_QUERY_LEN = 1000;
/** Gmail keeps at most 1000 filters per account. */
export const MAX_FILTERS = 1000;

const ADDRESS = /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;
const DOMAIN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;
const LIST_ID = /^[a-z0-9][a-z0-9._-]*(\.[a-z0-9._-]+)+$/;
/** Characters and words that are Gmail search operators or break an XML/JSON value. */
const SUBJECT_FORBIDDEN = /["(){}<>\\\n\r|*]/;
const SUBJECT_OPERATOR_WORD = /(^|\s)(OR|AND|NOT)(\s|$)/;

export const normalizeFrom = (raw: string): string => {
  const angle = /<([^>]+)>/.exec(raw);
  return (angle?.[1] ?? raw).trim().toLowerCase();
};

/** `null` when `value` is valid for `kind`, else the reason. */
export function checkMatchValue(kind: MatchKind, value: string): string | null {
  if (value.length === 0) return "empty value";
  if (value.length > (kind === "subject" ? MAX_SUBJECT_LEN : MAX_VALUE_LEN)) return `value longer than ${kind === "subject" ? MAX_SUBJECT_LEN : MAX_VALUE_LEN} characters`;
  switch (kind) {
    case "from":
      return ADDRESS.test(value) ? null : `"${value}" is not a plain address (lower case, no name, no operators)`;
    case "domain":
      return DOMAIN.test(value) ? null : `"${value}" is not a bare domain (example.com, no @, no wildcard)`;
    case "list-id":
      return LIST_ID.test(value) ? null : `"${value}" is not a list id (dotted, no brackets)`;
    case "subject":
      if (SUBJECT_FORBIDDEN.test(value)) return "subject pattern contains a quote, bracket, brace, pipe, wildcard or backslash";
      if (SUBJECT_OPERATOR_WORD.test(value) || value.startsWith("-")) return "subject pattern contains a Gmail operator (OR, AND, NOT, leading -)";
      if (value.trim() !== value || value.length < 4) return "subject pattern must be trimmed and at least 4 characters";
      return null;
  }
}

export function parseMatch(text: string): { match: Match } | { error: string } {
  const m = /^(from|domain|list-id|subject):(.+)$/.exec(text.trim());
  if (!m) return { error: `expected from:<address>, domain:<domain>, list-id:<id> or subject:<phrase>, got "${text}"` };
  const kind = m[1] as MatchKind;
  const value = kind === "subject" ? (m[2] as string).trim() : (m[2] as string).trim().toLowerCase();
  const err = checkMatchValue(kind, value);
  return err ? { error: err } : { match: { kind, value } };
}

/** Does the target address (a `from` of a message) fall under `m`? Only from/domain matches can say. */
export function coversAddress(m: Match, address: string): boolean {
  const a = normalizeFrom(address);
  if (m.kind === "from") return a === m.value;
  if (m.kind === "domain") {
    const dom = a.slice(a.lastIndexOf("@") + 1);
    return dom === m.value;
  }
  return false;
}

/** Do two from/domain matches name an overlapping set of senders? */
export function overlaps(a: Match, b: Match): boolean {
  if (a.kind === "from") return coversAddress(b, a.value) || (b.kind === "from" && a.value === b.value);
  if (a.kind === "domain") {
    if (b.kind === "domain") return a.value === b.value;
    if (b.kind === "from") return coversAddress(a, b.value);
  }
  return false;
}
