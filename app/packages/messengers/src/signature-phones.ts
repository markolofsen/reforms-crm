import { e164 } from "./autolink";

/**
 * Phones in a mail's signature (P84): deterministic, no model. Looks only at the signature block (after a `-- ` line or a sign-off
 * such as "Best regards", else the last 12 lines), drops quoted lines (`>`) and a quoted reply's header, and keeps a number only
 * when it is written with its country code (`+` or `00`): a local number is not guessed into one.
 *
 * Not wired (decision 0036 point 3 as amended by P84): the server reads no mail text, and a signature is the sender's own text, so a
 * phone found here may only ever SUGGEST a chat, never link one by itself.
 */

const SIGNOFF = /^(--\s*|best( regards)?|kind regards|regards|cheers|thanks|thank you|sincerely|warm regards|all the best|br|с уважением|спасибо|terima kasih|salam)[,.!\s]*$/iu;
const REPLY_HEADER = /^(on .+ wrote:|.+ написал\(а\):|-{2,}\s*original message\s*-{2,}|from:\s)/iu;
const NUMBER = /(?:\+|00)\d[\d\s\-().]{6,22}\d/g;
const TAIL = 12;

/** The lines of the signature block, quoted text and anything after a reply header removed. */
export function signatureBlock(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (REPLY_HEADER.test(raw.trim())) break;
    if (!raw.trimStart().startsWith(">")) lines.push(raw);
  }
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SIGNOFF.test(lines[i]!.trim())) {
      start = i + 1;
      break;
    }
  }
  return start >= 0 ? lines.slice(start) : lines.slice(-TAIL);
}

/** The distinct E.164 numbers of a mail's signature, in the order written. */
export function extractSignaturePhones(text: string): string[] {
  const out: string[] = [];
  for (const line of signatureBlock(text)) {
    for (const m of line.matchAll(NUMBER)) {
      const n = e164(m[0]);
      if (n && !out.includes(n)) out.push(n);
    }
  }
  return out;
}
