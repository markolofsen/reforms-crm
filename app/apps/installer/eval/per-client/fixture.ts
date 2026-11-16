// The 20-client fixture of the per-client eval (P28 E1, research 15 section 5). Invented people, invented places, one
// reserved example domain. Every client has two NEEDLES: facts that exist only in that client's own thread or profile.
// A reply written for the client must contain at least one of them and none of another client's.

export type Shape = "plain" | "first-contact" | "empty-profile" | "empty-first-contact" | "long-thread" | "stale-profile" | "near-twin" | "do-not-contact" | "scheduling" | "last-is-ours";
export type Profile = "filled" | "empty" | "absent";

export interface FixtureClient {
  n: number;
  name: string;
  email: string;
  shape: Shape;
  profile: Profile;
  /** Messages in the history search (both directions). 0: first contact. */
  found: number;
  /** Mail-mcp ids of the history, newest first; ids[0] is the message to answer (or our own last message). */
  ids: number[];
  needles: [string, string];
  /** Notion `last edited`, for the stale case. */
  profileEdited?: string;
  newest: string;
  /** Do we draft for this client? */
  drafted: boolean;
}

const FIRST = ["Anna", "Boris", "Chen", "Dana", "Emil", "Farah", "Goran", "Hana", "Ivo", "Jana", "Karim", "Lena", "Milan", "Nadia", "Omar", "Petra", "Quinn", "Rosa", "Sven", "Tara"];
const LAST = ["Novak", "Petrov", "Wei", "Cole", "Roth", "Haddad", "Ilic", "Sato", "Marsh", "Kral", "Aziz", "Berg", "Duric", "Okafor", "Nasser", "Lund", "Reyes", "Silva", "Holm", "Verma"];
// Two needles each: distinct, several words long, never reused.
const NEEDLES: Array<[string, string]> = [
  ["the certificate of title for lot 14", "the detached four-bed share on Harbour Road"],
  ["the flood survey from March", "the pump room under the east stairs"],
  ["the roof warranty expiring in 2031", "the solar array on the garage"],
  ["the party wall letter from number 9", "the shared drive on Elm Court"],
  ["the leasehold extension quote", "the ground rent of 250 pounds"],
  ["the vineyard plot above Ridge Lane", "the cellar door permit"],
  ["the allotment waiting list number 31", "the shed by the north gate"],
  ["the boat berth at Pier Six", "the winter mooring invoice"],
  ["the fourteen-message thread about the septic tank", "the percolation test in April"],
  ["the greenhouse kit from Dunmore", "the planning exemption for glass"],
  ["the loft conversion with the dormer facing west", "the structural engineer named Weller"],
  ["the loft conversion with the skylight facing east", "the structural engineer named Quarry"],
  ["the stop request after the second reminder", "the written complaint about the phone calls"],
  ["the viewing on the corner unit in Foundry Yard", "the call slot after school pickup"],
  ["our promise to send the drainage plan", "the plan for the lower field"],
  ["the orchard barn with the cracked beam", "the insurer visit on a Thursday"],
  ["the canal-side mooring at Lock Four", "the towpath access gate code"],
  ["the stable block conversion at Hollin Farm", "the bat survey result"],
  ["the garden room with the green oak frame", "the delivery window in late May"],
  ["the coach house deeds held at the bank", "the right of way over the back lane"],
];

const newestOf = (n: number) => `2026-11-${String(2 + (n % 12)).padStart(2, "0")}`;

function make(n: number, shape: Shape, profile: Profile, found: number, drafted: boolean, extra: Partial<FixtureClient> = {}): FixtureClient {
  const i = n - 1;
  const base = 1000 + n * 100;
  return {
    n,
    name: `${FIRST[i]} ${LAST[i]}`,
    email: `${FIRST[i]!.toLowerCase()}.${LAST[i]!.toLowerCase()}@clients.example`,
    shape,
    profile,
    found,
    ids: Array.from({ length: found }, (_, k) => base + found - k),
    needles: NEEDLES[i]!,
    newest: newestOf(n),
    drafted,
    ...extra,
  };
}

export const CLIENTS: FixtureClient[] = [
  make(1, "plain", "filled", 6, true),
  make(2, "plain", "filled", 5, true),
  make(3, "plain", "filled", 8, true),
  make(4, "plain", "filled", 7, true),
  make(5, "first-contact", "absent", 0, true, { ids: [1500] }),
  make(6, "first-contact", "absent", 0, true, { ids: [1600] }),
  make(7, "empty-profile", "empty", 5, true),
  make(8, "empty-first-contact", "absent", 0, true, { ids: [1800] }),
  make(9, "long-thread", "filled", 14, true),
  make(10, "stale-profile", "filled", 6, true, { profileEdited: "2026-04-20" }),
  make(11, "near-twin", "filled", 5, true),
  make(12, "near-twin", "filled", 5, true),
  make(13, "do-not-contact", "filled", 4, false),
  make(14, "scheduling", "filled", 3, false),
  make(15, "last-is-ours", "filled", 4, false),
  make(16, "plain", "filled", 5, true),
  make(17, "plain", "filled", 6, true),
  make(18, "plain", "filled", 5, true),
  make(19, "plain", "filled", 7, true),
  make(20, "plain", "filled", 6, true),
];

export const DRAFTED = CLIENTS.filter((c) => c.drafted);
export const FIXTURE_PROJECT = "fixture-pc";
export const NEEDLES_JSON = CLIENTS.map((c) => ({ n: c.n, email: c.email, needles: c.needles }));

/** A reply for this client, written from its own needles: what a careful agent would draft. Frames vary so no two replies share a template. */
const FRAMES: Array<(c: FixtureClient) => string> = [
  (c) => `Thank you for writing again. About ${c.needles[0]}: we have it on file and will confirm the next step this week. As for ${c.needles[1]}, please send a photo when you can.`,
  (c) => `Good to hear from you. Your note on ${c.needles[1]} helps a lot, and I am checking ${c.needles[0]} with the team before I promise a date.`,
  (c) => `I went through your earlier messages once more before answering. ${c.needles[0]} is the first thing to settle, and ${c.needles[1]} can follow once that is clear.`,
  (c) => `Two points after your last mail. First, ${c.needles[0]}, where I will ask the owner what we can offer. Second, ${c.needles[1]}, which needs nothing from you yet.`,
  (c) => `Back to you on ${c.needles[1]}. It fits what you told us about ${c.needles[0]}, so I suggest we deal with both during one visit.`,
  (c) => `Your last message mentioned ${c.needles[0]}, and that changes my answer. Could you also confirm ${c.needles[1]} so nothing is left open on our side?`,
  (c) => `A short reply for now. We are still waiting on the paperwork for ${c.needles[1]}; meanwhile ${c.needles[0]} stays exactly as you described it last time.`,
  (c) => `Let me pick up where we stopped. You asked about ${c.needles[0]}; I can answer that today. The remaining question, ${c.needles[1]}, I will pass to a colleague.`,
  (c) => `Welcome and thanks for the detail. ${c.needles[0]} is clear to me now, so the only open item is ${c.needles[1]}, which we can sort out by phone if you prefer.`,
  (c) => `Having read the thread again, I would start with ${c.needles[1]} and leave ${c.needles[0]} for the second step, since the second depends on the first.`,
];

export function replyBody(c: FixtureClient): string {
  const frame = FRAMES[(c.n - 1) % FRAMES.length]!;
  const second = c.n <= 10 ? `Until then I have noted "${c.needles[1]}" in your file so a colleague can pick it up.` : `For the record, ${c.needles[0]} was the part you stressed, and ${c.needles[1]} the part you were unsure about.`;
  return `[hub-draft thread=m${c.ids[0]}@clients.example]\nHi ${c.name.split(" ")[0]},\n\n${frame(c)} ${second}\n\nKind regards, the desk`;
}
