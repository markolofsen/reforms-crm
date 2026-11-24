import type { IdentifierKind } from "@hub/db";
import { MessengersError } from "./errors";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * One spelling per identity, so the unique index means something: e-mail lower-cased, a Telegram chat as its
 * integer id (`-100...` for groups), a phone or WhatsApp number as `+` and digits (spaces, dashes, brackets removed); a WhatsApp chat
 * whose number is hidden as `lid:<digits>`.
 */
export function normalizeIdentifier(kind: IdentifierKind, raw: string): string {
  const v = raw.trim();
  const bad = () => new MessengersError("bad_identifier", `bad_identifier: "${raw}" is not a valid ${kind}`);
  switch (kind) {
    case "email":
      if (!EMAIL.test(v)) throw bad();
      return v.toLowerCase();
    case "telegram":
      if (!/^-?\d{1,20}$/.test(v)) throw bad();
      return String(BigInt(v));
    case "telegram_username": {
      // P141 C1: lower-case, without `@` or a t.me link (Telegram usernames are 5 to 32 letters, digits and underscores).
      const u = v.replace(/^(https?:\/\/)?t\.me\//i, "").replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9_]{4,32}$/.test(u)) throw bad();
      return u;
    }
    case "phone":
    case "whatsapp": {
      // A WhatsApp chat whose number is hidden is named by its LID (P141 verdict 5).
      if (kind === "whatsapp" && /^lid:\d{1,20}$/.test(v)) return v;
      const digits = v.replace(/[\s\-().]/g, "").replace(/^00/, "+");
      if (!/^\+?\d{7,15}$/.test(digits)) throw bad();
      return digits.startsWith("+") ? digits : `+${digits}`;
    }
  }
}
