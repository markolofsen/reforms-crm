// P120 W4: the pure text helpers of a message (no Mail.app, no osascript), so a server route reads them without reaching
// the Mail.app adapter (P113: routes never import `@hub/mail-app/read` or the scripts).

/**
 * The client's own words of a message: what is above the quote of the earlier mail. The quote starts at a line that is a
 * reply header (`On … wrote:`, any line ending in `<address>:` as Gmail writes it in other languages, `-----Original
 * Message-----`, `From: …` after a blank line) or at the first `>` line. `quoted` says whether anything was cut.
 */
export function ownText(content: string): { text: string; quoted: boolean } {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] ?? "").trim();
    if (/^>/.test(l) || /^On\b.*\bwrote:$/i.test(l) || /<[^<>\s]+@[^<>\s]+>:$/.test(l) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l) || (/^From:\s/i.test(l) && i > 0 && (lines[i - 1] ?? "").trim() === "")) {
      cut = i;
      break;
    }
  }
  return { text: lines.slice(0, cut).join("\n").trim(), quoted: cut < lines.length };
}

/** At most `n` characters of the client's own words on one line (the stored preview, decision 0013). */
export const previewOf = (content: string, n: number): string => ownText(content).text.replace(/\s+/g, " ").trim().slice(0, n);
