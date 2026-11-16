// Analyzer: sender samples in (headers only, fed from mail-mcp read results, injected), proposed rules out.
// Never proposes client, partner or spam: those come from the owner. Uncertain groups stay unclassified.
import { checkMatchValue, coversAddress, normalizeFrom } from "./match.js";
import { normalizeRules } from "./rules-file.js";
import { classesOf, defaultLabel, skippableIds, type MailClass, type Action, type Category, type Rule, type RulesFile } from "./model.js";

export interface SenderSample {
  /** `Name <a@b>` or `a@b`. */
  from: string;
  subject?: string;
  /** List-Id header value, brackets optional. */
  listId?: string;
  /** A List-Unsubscribe header was present. */
  hasUnsubscribe?: boolean;
  /** Precedence: bulk or list. */
  bulk?: boolean;
}

export interface Proposal {
  rule: Rule;
  /** 0..1. */
  confidence: number;
  count: number;
  examples: string[];
  /** Below the auto threshold: show to the owner and ask. */
  needsConfirmation: boolean;
}

export interface Unclassified {
  group: string;
  senders: string[];
  count: number;
  reason: string;
}

export interface ProposeResult {
  proposals: Proposal[];
  unclassified: Unclassified[];
  /** Whitelisted senders seen in the sample: counted, never proposed. */
  protectedSenders: { from: string; count: number }[];
  /** Messages already covered by an existing rule, and the project's own mail: not analysed again. */
  covered: number;
  ignored: number;
}

export const AUTO_CONFIDENCE = 0.8;
export const MIN_CONFIDENCE = 0.5;

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "mail.ru", "yandex.ru", "gmx.de", "gmx.net", "web.de", "proton.me", "protonmail.com", "aol.com"]);

const CALENDAR_SENDER = /^(calendar-notification|calendar-invites?|invites?)@|(^|\.)calendly\.com$|(^|\.)cal\.com$/;
const CALENDAR_SUBJECT = /^(updated invitation|invitation|accepted|declined|tentatively accepted|canceled event|new event)\b.*[:@]|calendly|reminder: .*(meeting|call)/i;
const SECURITY_SUBJECT = /(verification code|verify your|password reset|reset your password|sign-?in|new login|security alert|two-factor|\b2fa\b|one-time (code|password)|confirm your (email|account)|код подтверждения|подтвердите)/i;
const SERVICE_LOCAL = /^(no-?reply|do-?not-?reply|notifications?|alerts?|billing|receipts?|invoices?|system|mailer|support-noreply)([._+-].*)?$/;
const SERVICE_SUBJECT = /(receipt|invoice|your order|has shipped|payment (received|failed|successful)|statement is ready|квитанци|счёт)/i;
const PROMO_SUBJECT = /(% off|\bsale\b|discount|newsletter|webinar|special offer|limited time|black friday|скидк|распродаж)/i;
const COLD_SUBJECT = /(quick question|partnership opportunity|collaboration opportunity|guest post|\bseo\b|lead generation|i noticed your|following up on my)/i;

export const domainOf = (address: string): string => address.slice(address.lastIndexOf("@") + 1);

const normListId = (v: string): string => (/<([^>]+)>/.exec(v)?.[1] ?? v).trim().toLowerCase();

interface Vote {
  category: Category | null;
  strength: number;
  reason: string;
}

function vote(s: SenderSample, from: string): Vote {
  const subject = s.subject ?? "";
  const local = from.slice(0, from.lastIndexOf("@"));
  const bulk = !!(s.hasUnsubscribe || s.bulk || s.listId);
  if (CALENDAR_SENDER.test(from) || CALENDAR_SENDER.test(domainOf(from)) || CALENDAR_SUBJECT.test(subject)) return { category: "calendar", strength: 0.9, reason: "calendar invite wording or sender" };
  if (SECURITY_SUBJECT.test(subject)) return { category: "security", strength: 0.9, reason: "verification or security wording in the subject" };
  const promo = PROMO_SUBJECT.test(subject);
  const noreply = SERVICE_LOCAL.test(local);
  if (bulk && promo) return { category: "marketing", strength: 0.9, reason: "bulk headers and promotional wording" };
  if (bulk && noreply) return { category: "service", strength: 0.6, reason: "noreply sender with an unsubscribe header (service or marketing)" };
  if (bulk) return { category: "marketing", strength: 0.85, reason: "List-Unsubscribe, List-Id or bulk precedence" };
  if (noreply || SERVICE_SUBJECT.test(subject)) return { category: "service", strength: 0.8, reason: "noreply or notification sender, or receipt wording" };
  if (promo) return { category: "marketing", strength: 0.6, reason: "promotional wording only" };
  if (COLD_SUBJECT.test(subject)) return { category: "cold-outreach", strength: 0.5, reason: "unsolicited-pitch wording, no bulk headers" };
  return { category: null, strength: 0, reason: "" };
}

export interface ProposeOptions {
  /** The kind's mail classes (default: those of `existing`, else the generic set). */
  classes?: readonly MailClass[];
  whitelist?: RulesFile["whitelist"];
  existing?: RulesFile;
  /** The project's own addresses: dropped. */
  ownAddresses?: string[];
  /** ISO date stamped on every proposal. */
  today: string;
}

export function propose(samples: SenderSample[], o: ProposeOptions): ProposeResult {
  const whitelist = o.whitelist ?? [];
  const existing = o.existing ? normalizeRules(o.existing) : null;
  const own = new Set((o.ownAddresses ?? []).map(normalizeFrom));
  const result: ProposeResult = { proposals: [], unclassified: [], protectedSenders: [], covered: 0, ignored: 0 };
  const prot = new Map<string, number>();
  const groups = new Map<string, { domain: string; free: boolean; items: { from: string; s: SenderSample; v: Vote }[] }>();

  for (const s of samples) {
    const from = normalizeFrom(s.from);
    if (!from.includes("@")) {
      result.ignored++;
      continue;
    }
    if (own.has(from)) {
      result.ignored++;
      continue;
    }
    if (whitelist.some((w) => coversAddress(w.match, from))) {
      prot.set(from, (prot.get(from) ?? 0) + 1);
      continue;
    }
    if (existing?.rules.some((r) => coversAddress(r.match, from) || (r.match.kind === "list-id" && s.listId && normListId(s.listId) === r.match.value))) {
      result.covered++;
      continue;
    }
    const dom = domainOf(from);
    const free = FREE_MAIL.has(dom);
    // Exact host, not the registrable domain: Gmail `@host` does not match subdomains.
    const key = free ? from : dom;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { domain: key, free, items: [] }));
    g.items.push({ from, s, v: vote(s, from) });
  }
  result.protectedSenders = [...prot.entries()].map(([from, count]) => ({ from, count })).sort((a, b) => b.count - a.count || (a.from < b.from ? -1 : 1));

  for (const g of [...groups.values()].sort((a, b) => b.items.length - a.items.length || (a.domain < b.domain ? -1 : 1))) {
    const senders = [...new Set(g.items.map((i) => i.from))].sort();
    const tally = new Map<Category, { n: number; sum: number; reason: string }>();
    for (const i of g.items) {
      if (!i.v.category) continue;
      const t = tally.get(i.v.category) ?? { n: 0, sum: 0, reason: i.v.reason };
      t.n++;
      t.sum += i.v.strength;
      tally.set(i.v.category, t);
    }
    const top = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[1].sum - a[1].sum)[0];
    const total = g.items.length;
    const unclassified = (reason: string) => result.unclassified.push({ group: g.domain, senders, count: total, reason });
    if (!top) {
      unclassified("no signal: no bulk headers, no automated sender, no known wording");
      continue;
    }
    const [category, t] = top;
    const confidence = Math.round((t.n / total) * (t.sum / t.n) * 100) / 100;
    if (confidence < MIN_CONFIDENCE) {
      unclassified(`mixed or weak: ${[...tally.entries()].map(([c, x]) => `${c} ${x.n}`).join(", ")} of ${total}`);
      continue;
    }
    const kind = g.free ? "from" : "domain";
    const value = g.domain;
    if (checkMatchValue(kind, value)) {
      unclassified(`value "${value}" is not usable in a filter`);
      continue;
    }
    // A domain rule must not swallow a whitelisted address of that domain.
    if (kind === "domain" && whitelist.some((w) => (w.match.kind === "domain" ? w.match.value : domainOf(w.match.value)) === value)) {
      unclassified("the domain also holds a whitelisted client address; classify its senders one by one");
      continue;
    }
    const needsConfirmation = confidence < AUTO_CONFIDENCE;
    const skippable = skippableIds(o.classes ?? classesOf(o.existing ?? {})).includes(category);
    const action: Action = skippable && !needsConfirmation ? "label+skip+read" : "label";
    const examples = [...new Set(g.items.filter((i) => i.v.category === category).map((i) => i.s.subject ?? "").filter(Boolean))].slice(0, 2);
    result.proposals.push({
      rule: {
        match: { kind, value },
        category,
        label: defaultLabel(category),
        action,
        why: `${t.n} of ${total} message${total === 1 ? "" : "s"}: ${t.reason}`,
        date: o.today,
        by: "agent",
      },
      confidence,
      count: total,
      examples,
      needsConfirmation,
    });
  }
  return result;
}

/** Read-only lookup for skills and tests: how would this message be classified by the rules file? Whitelist first. */
export function classifyMessage(file: RulesFile, m: { from: string; listId?: string; subject?: string }): { category: Category; label: string; action: Action } | null {
  const from = normalizeFrom(m.from);
  if (file.whitelist.some((w) => coversAddress(w.match, from))) return { category: "client", label: defaultLabel("client"), action: "label" };
  const hit = normalizeRules(file).rules.find((r) => {
    if (r.match.kind === "list-id") return !!m.listId && normListId(m.listId) === r.match.value;
    if (r.match.kind === "subject") return !!m.subject && m.subject.toLowerCase().includes(r.match.value.toLowerCase());
    return coversAddress(r.match, from);
  });
  return hit ? { category: hit.category, label: hit.label, action: hit.action } : null;
}
