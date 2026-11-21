import { z } from "zod";
import { isEntryPath } from "./local";

// Refs (P72, decision 0038): a domain id written `<kind>:<id>`, the one vocabulary the admin's rows (`data-agent-ref`), the
// focus, the pointer and the agent's resolvers share. Re-exported by `./focus`; here so `./pointer` can use it without a cycle.

/** The kinds a ref can name. A kind without a resolver in `@hub/agent/focus` fails that package's test. */
// P71 M3: `chat` is a linked messenger chat (`messenger_chats.id`), `mdraft` a messenger draft (`messenger_drafts.id`), the rows
// of the Messengers panel; a mail draft stays `draft`.
// P98: `inbound` is a client's message the server's Mail reader stored (`inbound_mail.id`), the rows and the card of Mail ▸ Inbox.
export const REF_KINDS = ["draft", "client", "run", "knowledge", "project", "chat", "mdraft", "inbound"] as const;
export type RefKind = (typeof REF_KINDS)[number];

export const NUMERIC_ID = /^[1-9]\d{0,9}$/;
/** A project slug. */
export const SLUG = /^[a-z0-9][a-z0-9._-]*$/;
const ID_OK: Record<RefKind, (id: string) => boolean> = {
  draft: (id) => NUMERIC_ID.test(id),
  client: (id) => NUMERIC_ID.test(id),
  run: (id) => NUMERIC_ID.test(id),
  knowledge: (id) => isEntryPath(id),
  project: (id) => SLUG.test(id) && id.length <= 100,
  chat: (id) => NUMERIC_ID.test(id),
  mdraft: (id) => NUMERIC_ID.test(id),
  inbound: (id) => NUMERIC_ID.test(id),
};
const isKind = (k: string): k is RefKind => (REF_KINDS as readonly string[]).includes(k);

/** A ref is at most this long (a knowledge path is at most 400). */
export const REF_MAX = 420;

/** `draft:42` into its kind and id; null for anything that is not a ref of a known kind with a well-formed id. */
export function parseRef(ref: string): { kind: RefKind; id: string } | null {
  if (ref.length > REF_MAX) return null;
  const at = ref.indexOf(":");
  if (at <= 0) return null;
  const kind = ref.slice(0, at);
  const id = ref.slice(at + 1);
  return isKind(kind) && ID_OK[kind](id) ? { kind, id } : null;
}

/** The ref of a record: `refOf("draft", 42)` is `draft:42`. */
export const refOf = (kind: RefKind, id: string | number): string => `${kind}:${id}`;

export const agentRef = z.string().max(REF_MAX).refine((s) => parseRef(s) !== null, "not a ref (<kind>:<id>)");

