import { z } from "zod";

/**
 * A client's address key (P103 verdicts 1 and 2): the primary email, lower-cased (`/mail/c/ana%40example.com`), so the address
 * says who it is and is the same on every instance; `id-<row id>` only when the Hub holds no email for him. One parser, two
 * shapes; the old bare number (`/mail/c/42`) is no key (no alias). The server answers either with the canonical one.
 */
export type ClientRef = { readonly id: number } | { readonly email: string };

const EMAIL = /^[^\s@/?#]+@[^\s@/?#]+$/;
const ID = /^id-([1-9]\d*)$/;

/** The key of a client: his email when it looks like one, else `id-<id>`. */
export function clientKey(c: { readonly id: number; readonly email?: string | null }): string {
  const e = c.email?.trim().toLowerCase() ?? "";
  return EMAIL.test(e) && e.length <= 320 ? e : `id-${c.id}`;
}

/** A key from the address (URL-encoded or not) into what it names, or null when it names nothing (`42`, `abc`, `id-0`). */
export function parseClientKey(raw: string): ClientRef | null {
  let v: string;
  try {
    v = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  const id = ID.exec(v);
  if (id) return { id: Number(id[1]) };
  const e = v.toLowerCase();
  return EMAIL.test(e) && e.length <= 320 ? { email: e } : null;
}

/** `GET /api/projects/:slug/clients/key/:key`: the client a key names, with his canonical key (the address replaces to it). */
export const clientKeyDto = z.strictObject({ id: z.number().int().positive(), email: z.string(), key: z.string().min(1) });
export type ClientKeyDto = z.infer<typeof clientKeyDto>;

/** The canonical text of a key the parser accepted (`Ana@Example.com` → `ana@example.com`). */
export const keyText = (r: ClientRef): string => ("id" in r ? `id-${r.id}` : r.email);
