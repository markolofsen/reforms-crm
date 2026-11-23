// P126 P1: a closing the agent wrote itself (refused: the Hub signs), and the names a signature carries.
import type { Brand } from "../schema";
import { norm, signatureLines } from "./signature";

/**
 * Closing phrases a reply must not end with when the writer signs (P65 S2, P60 finding 1), lower case, no trailing
 * punctuation, in every language the Hub writes (en, ru, uk, de, es, fr, pt, it). The list is the third rule of
 * {@link ownSignoff}; the two structural rules catch a closing it does not name.
 */
export const SIGNOFF_PHRASES: readonly string[] = [
  // en
  "best regards", "kind regards", "warm regards", "warmest regards", "regards", "best wishes", "with best wishes", "with kind regards", "with warm regards", "best", "all the best", "cheers", "sincerely", "yours sincerely", "yours faithfully", "yours truly", "yours", "warmly", "respectfully", "take care", "talk soon", "thanks", "many thanks", "thank you", "with thanks", "thanks again",
  // ru
  "с уважением", "с наилучшими пожеланиями", "с теплом", "с почтением", "с приветом", "всего доброго", "всего наилучшего", "всего хорошего", "до связи", "искренне ваш", "искренне ваша", "спасибо", "с благодарностью",
  // uk
  "з повагою", "з найкращими побажаннями", "з теплом", "щиро ваш", "щиро ваша", "щиро", "всього найкращого", "всього доброго", "на все добре", "дякую", "з вдячністю",
  // de
  "mit freundlichen grüßen", "mit freundlichen grüssen", "freundliche grüße", "viele grüße", "beste grüße", "liebe grüße", "herzliche grüße", "schöne grüße", "grüße", "mfg", "hochachtungsvoll", "herzlichst", "danke", "vielen dank", "besten dank",
  // es
  "saludos", "saludos cordiales", "un saludo", "un cordial saludo", "atentamente", "cordialmente", "un abrazo", "abrazos", "afectuosamente", "gracias", "muchas gracias",
  // fr
  "cordialement", "bien cordialement", "bien à vous", "salutations", "sincères salutations", "meilleures salutations", "amicalement", "bien amicalement", "chaleureusement", "à bientôt", "merci", "merci beaucoup",
  // pt
  "atenciosamente", "abraços", "um abraço", "saudações", "cumprimentos", "melhores cumprimentos", "com os melhores cumprimentos", "obrigado", "obrigada", "muito obrigado", "muito obrigada",
  // it
  "cordiali saluti", "distinti saluti", "saluti", "un saluto", "un caro saluto", "a presto", "grazie", "grazie mille",
];

/** A thanks starts many a sentence ("Thanks, we will answer tomorrow"): matched only alone, or as a closing over a name line. */
const THANKS = new Set(["thanks", "many thanks", "thank you", "with thanks", "thanks again", "спасибо", "с благодарностью", "дякую", "з вдячністю", "danke", "vielen dank", "besten dank", "gracias", "muchas gracias", "merci", "merci beaucoup", "obrigado", "obrigada", "muito obrigado", "muito obrigada", "grazie", "grazie mille"]);

/** "<Brand> team", "Команда <Brand>", "L'équipe <Brand>": a line holding one of these words signs as a team. */
const TEAM_WORDS = new Set(["team", "команда", "команди", "teams", "equipo", "équipe", "l'équipe", "equipe", "squadra", "equipa"]);

const bare = (l: string) => norm(l).replace(/[\s.,;:!—–-]+$/u, "");
const words = (l: string): string[] => l.trim().split(/\s+/).filter(Boolean);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasToken = (line: string, token: string): boolean => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(token)}($|[^\\p{L}\\p{N}])`, "iu").test(line);

/**
 * A line that signs a name: at most five words (eight with a brand name or team word), no sentence or address punctuation (`. / @ : ? ! ;`), not a list item,
 * and a brand or signing name of the project in it, a team word ("Carapis team", "Команда Carapis"), or (`loose`) at
 * most three words that all start upper case ("Mark", "Anna Petrova").
 */
function nameLine(line: string, names: readonly string[], loose: boolean): boolean {
  const t = line.trim();
  const w = words(t);
  if (w.length === 0 || w.length > 8 || /[./@:?!;]/.test(t) || /^[-*•\d]/.test(t)) return false;
  // A brand or team line may be longer ("The Caribbean Real Estate MLS team"); a bare name is short.
  if (names.some((n) => hasToken(t, n))) return true;
  if (w.some((x) => TEAM_WORDS.has(x.toLowerCase()))) return true;
  if (w.length > 5) return false;
  return loose && w.length <= 3 && w.every((x) => /^\p{Lu}/u.test(x));
}

/**
 * A closing the agent typed itself (P65 S2): among the last four non-empty lines of its text (quotes not counted), the
 * first line that is
 * 1. one of the project's own sign-off or signature lines (any language);
 * 2. a closing over a name: a short line (at most seven words, no sentence punctuation or digit inside) ending with a
 *    comma, not the reply's first line (the greeting) nor a list's continuation, and every line after it a name line
 *    ("С теплом и дружеским поклоном,\nКоманда Carapis", "Thanks,\nMark"), in any language;
 * 3. a team or brand name line with only name lines after it ("Carapis team", "Команда Carapis");
 * 4. a closing phrase of {@link SIGNOFF_PHRASES}: alone, with a short name after a comma ("Best regards, Mark"), or as
 *    the start of a longer closing ending with a comma ("С теплом и дружеским поклоном,").
 * `names` are the project's brand names and the names its signature lines sign with. Null when the text ends without
 * a closing. Pure; the text is never edited.
 */
export function ownSignoff(body: string, own: readonly string[] = [], names: readonly string[] = []): string | null {
  const lines = body.split("\n").filter((l) => l.trim() !== "" && !/^\s*>/.test(l));
  const from = Math.max(0, lines.length - 4);
  const mine = new Set(own.map(bare).filter(Boolean));
  const ns = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))];
  const signs = (l: string, loose: boolean) => mine.has(bare(l)) || nameLine(l, ns, loose);
  const restSigns = (i: number, loose: boolean) => lines.slice(i + 1).every((l) => signs(l, loose));
  for (let i = from; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const t = raw.trim();
    const b = bare(raw);
    if (mine.has(b)) return t;
    const prev = (lines[i - 1] ?? "").trim();
    const closing = /,$/.test(t) && words(t).length <= 7 && !/[.?!:;\d]/.test(t.slice(0, -1)) && i > 0 && !/[,:]$/.test(prev);
    if (closing && i < lines.length - 1 && restSigns(i, true)) return t;
    if (nameLine(t, ns, false) && restSigns(i, false)) return t;
    for (const p of SIGNOFF_PHRASES) {
      if (b === p) return t;
      if (THANKS.has(p)) continue;
      if (b.startsWith(`${p},`) && words(b.slice(p.length + 1)).length <= 3) return t;
      if (p.includes(" ") && b.startsWith(`${p} `) && /,$/.test(t) && words(t).length <= 7 && restSigns(i, true)) return t;
    }
  }
  return null;
}

/** The names a project signs with, for {@link ownSignoff}: its brand names and every word group of its signature lines that is not a domain. */
export const signingNames = (c: { signoff: string; brands: readonly Brand[] }): string[] => [...new Set([...c.brands.map((b) => b.name), ...signatureLines(c).filter((l) => !/[./@:]/.test(l) && !/,$/.test(l.trim()))].map((n) => n.trim()).filter(Boolean))];
