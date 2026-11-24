// P138 E1 (verdicts 1, 2 and 6): a lead's form as the card shows it. The writers put every field without a column of its own in
// `Details`, one `Label: value` line each (@docs/core/21-leads.md; django_notion's `build_details`). This file turns those lines into
// what the person wants (known labels first, in a fixed order, then every unknown one), the contact channel, the sites they named
// and the technical lines (locale, hosts, consent, environment, tracking): shown last and smaller, never hidden. Pure.

export interface LeadFormField {
  /** A known field's key (`website`, `country`, ...), else `other`. */
  key: string;
  label: string;
  value: string;
  /** A web page for the value (the company website), else null. */
  href: string | null;
}

export const LEAD_CHANNEL_KINDS = ["whatsapp", "telegram", "email", "phone", "other"] as const;
export type LeadChannelKind = (typeof LEAD_CHANNEL_KINDS)[number];

export interface LeadForm {
  fields: LeadFormField[];
  /** The `Contact channel:` line: WhatsApp, Telegram, email, phone or another channel, and what they typed. */
  channel: { kind: LeadChannelKind; value: string } | null;
  /** The sites they named (`Wanted sources`, and the domains in their message), each with its page when it is a domain. */
  sites: { name: string; href: string | null }[];
  technical: { label: string; value: string }[];
}

/** The list row's facts (verdict 6): the website or the first site, the country's name, the segment, the volume. */
export interface LeadFacts {
  site: string | null;
  country: string | null;
  segment: string | null;
  volume: string | null;
}

/** Known business labels (lower case) → key and the label shown, in the order shown. */
const KNOWN: readonly { key: string; label: string; names: readonly string[] }[] = [
  { key: "company", label: "Company", names: ["company", "company name"] },
  { key: "website", label: "Website", names: ["company website", "website", "site url", "company site"] },
  { key: "country", label: "Country", names: ["country"] },
  { key: "segment", label: "Segment", names: ["segment", "business type", "type of business"] },
  { key: "volume", label: "Expected volume", names: ["expected volume", "monthly volume", "volume"] },
];
const CHANNEL_NAMES = ["contact channel", "preferred contact", "contact"];
const SITE_NAMES = ["wanted sources", "wanted sites", "sites", "sources"];
/** Technical labels: the form's machinery, not what the person asked. A prefix match covers `UTM source`, `Ad click time`. */
const TECHNICAL = ["locale", "api host", "consent version", "consent", "environment", "site", "project", "source page", "page url", "form", "form id", "user agent", "ip", "referrer", "mailbox", "gclid", "gbraid", "wbraid", "msclkid", "linkedin click id"];
const TECHNICAL_PREFIX = ["utm ", "ad click", "ad consent"];

const isTechnical = (name: string) => TECHNICAL.includes(name) || TECHNICAL_PREFIX.some((p) => name.startsWith(p));
const known = (name: string) => KNOWN.find((k) => k.names.includes(name));

/** `Label: value` lines; a line without a label continues the value above it (a long value cut over lines). */
export function detailLines(details: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const raw of details.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^:]{1,60}):\s*(.*)$/.exec(line);
    const last = out.at(-1);
    if (m && m[1] && !/^https?$/i.test(m[1].trim())) out.push({ label: m[1].trim(), value: (m[2] ?? "").trim() });
    else if (last) last.value = `${last.value} ${line}`.trim();
    else out.push({ label: "Details", value: line });
  }
  return out.filter((l) => l.value !== "");
}

/** A web page for a typed website or domain (`example.com`, `https://example.com/x`), else null. */
export function webPageOf(v: string): string | null {
  const t = v.trim();
  if (/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(t)) return t;
  if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?$/i.test(t)) return `https://${t}`;
  return null;
}

/** The host of a website value, without `www.` (`https://www.Example.com/x` → `example.com`), else null. */
export function hostOf(v: string | null | undefined): string | null {
  const page = v ? webPageOf(v) : null;
  const m = page ? /^https?:\/\/([^/?#\s:]+)/i.exec(page) : null;
  return m?.[1] ? m[1].toLowerCase().replace(/^www\./, "") : null;
}

/** A two-letter country code as its English name (`AE` → `United Arab Emirates`); any other value as typed. */
export function countryName(v: string): string {
  const t = v.trim();
  if (!/^[A-Za-z]{2}$/.test(t)) return t;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(t.toUpperCase()) ?? t;
  } catch {
    return t;
  }
}

/** `WhatsApp: +971 50 …`, `Telegram: @name`, `Email: a@b.co`, a bare email or phone: the channel's kind and what they typed. */
export function channelOf(value: string): { kind: LeadChannelKind; value: string } | null {
  const v = value.trim();
  if (!v) return null;
  const m = /^(whats\s*app|telegram|e-?mail|phone|tel|call)\s*:\s*(.+)$/i.exec(v);
  const name = m?.[1]?.toLowerCase().replace(/\s|-/g, "") ?? "";
  const rest = (m?.[2] ?? v).trim();
  if (name === "whatsapp") return { kind: "whatsapp", value: rest };
  if (name === "telegram") return { kind: "telegram", value: rest };
  if (name === "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rest)) return { kind: "email", value: rest };
  if (name === "phone" || name === "tel" || name === "call" || /^\+?[\d\s().-]{7,}$/.test(rest)) return { kind: "phone", value: rest };
  return { kind: "other", value: v.slice(0, 120) };
}

const DOMAIN_IN_TEXT = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+(?:com|net|org|de|fr|it|es|nl|be|pl|uk|ie|pt|ch|at|se|no|dk|fi|cz|ro|hu|gr|bg|hr|si|sk|lt|lv|ee|ua|tr|ae|sa|ma|jp|kr|cn|vn|au|nz|ca|us|mx|br|ar|cl|co|in|id|ph|th|my|sg|za|ru|io|ai|app|auto|cars|eu)(?:\.[a-z]{2})?)\b/gi;

/** The sites a message names, as domains (`mobile.de`, `www.autoscout24.com`), in order, once each. */
export function domainsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DOMAIN_IN_TEXT)) {
    const d = (m[1] ?? "").toLowerCase().replace(/^www\./, "");
    if (d && !d.includes("@") && !out.includes(d)) out.push(d);
  }
  return out;
}

/** The form of one lead: its Details lines sorted into what they want, the channel, the sites and the technical lines. */
export function leadFormOf(l: { details: string; company?: string | null; message?: string; form?: string | null; pageUrl?: string | null }): LeadForm {
  const fields: LeadFormField[] = [];
  const other: LeadFormField[] = [];
  const technical: { label: string; value: string }[] = [];
  const sites: { name: string; href: string | null }[] = [];
  let channel: LeadForm["channel"] = null;
  const addSite = (name: string) => {
    const n = name.trim();
    if (n && !sites.some((s) => s.name.toLowerCase() === n.toLowerCase())) sites.push({ name: n, href: webPageOf(n) });
  };
  if (l.company) fields.push({ key: "company", label: "Company", value: l.company, href: null });
  for (const { label, value } of detailLines(l.details)) {
    const name = label.toLowerCase();
    const k = known(name);
    if (k) {
      if (fields.some((f) => f.key === k.key)) continue;
      const shown = k.key === "country" ? countryName(value) : value;
      fields.push({ key: k.key, label: k.label, value: shown, href: k.key === "website" ? webPageOf(value) : null });
    } else if (CHANNEL_NAMES.includes(name)) channel ??= channelOf(value);
    else if (SITE_NAMES.includes(name)) value.split(/[,;]/).forEach(addSite);
    else if (isTechnical(name)) technical.push({ label, value });
    else other.push({ key: "other", label, value, href: null });
  }
  for (const d of domainsIn(l.message ?? "")) addSite(d);
  if (l.form) technical.push({ label: "Form", value: l.form });
  if (l.pageUrl) technical.push({ label: "Page URL", value: l.pageUrl });
  const order = (f: LeadFormField) => KNOWN.findIndex((k) => k.key === f.key);
  return { fields: [...fields.sort((a, b) => order(a) - order(b)), ...other], channel, sites, technical };
}

const SHORT = 60;
const short = (v: string | undefined): string | null => (v ? v.slice(0, SHORT) : null);

/** The list row's facts of a form (stored on the lead row, P138 E1; decision 0013 widened by four short facts). */
export function leadFactsOf(f: LeadForm): LeadFacts {
  const value = (key: string) => f.fields.find((x) => x.key === key)?.value;
  const website = value("website");
  return { site: short(hostOf(website) ?? website ?? f.sites[0]?.name), country: short(value("country")), segment: short(value("segment")), volume: short(value("volume")) };
}
