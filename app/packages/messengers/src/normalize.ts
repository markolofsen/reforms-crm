import type { IdentifierKind } from "@hub/db";
import { MessengersError } from "./errors";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * One spelling per identity, so the unique index means something: e-mail lower-cased, a Telegram chat as its
 * integer id (`-100...` for groups), a phone or WhatsApp number as `+` and digits (spaces, dashes, brackets removed).
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
    case "phone":
    case "whatsapp": {
      const digits = v.replace(/[\s\-().]/g, "").replace(/^00/, "+");
      if (!/^\+?\d{7,15}$/.test(digits)) throw bad();
      return digits.startsWith("+") ? digits : `+${digits}`;
    }
  }
}
