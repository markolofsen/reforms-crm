/** The reply languages currently supported by the shared Mail signature contract. */
export type ReplyLanguage = "en" | "ru";

/**
 * Detect the language of the owner's own reply text. Quoted lines are excluded
 * so a copied Russian or English message cannot change the signature choice.
 */
export function replyLanguage(body: string): ReplyLanguage {
  const own = body.split("\n").filter((line) => !/^\s*>/.test(line)).join("\n");
  const letters = own.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return "en";
  const cyrillic = letters.filter((letter) => /\p{Script=Cyrillic}/u.test(letter)).length;
  return cyrillic / letters.length > 0.5 ? "ru" : "en";
}
