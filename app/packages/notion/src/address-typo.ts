// P138 E1 (verdict 4): a mistyped domain in a lead's address, from a fixed list of common typos, so the owner sees it before a
// reply bounces ("almirsolutions.vom: did they mean .com?"). Never a guess beyond the list: a real top-level domain (.co, .cm,
// .om) is never "corrected". Pure.

/** Mail providers typed wrong → the provider. */
const PROVIDERS: Readonly<Record<string, string>> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com", "gmal.com": "gmail.com", "gmail.cm": "gmail.com", "gmail.co": "gmail.com", "gmail.om": "gmail.com", "googlemail.co": "googlemail.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmil.com": "hotmail.com", "hotmail.co": "hotmail.com",
  "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "yahoo.co": "yahoo.com", "yhoo.com": "yahoo.com",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "outlook.co": "outlook.com", "otlook.com": "outlook.com",
  "iclod.com": "icloud.com", "icoud.com": "icloud.com", "icloud.co": "icloud.com",
};

/** Top-level domains typed wrong → the one meant. None of the keys is a real top-level domain. */
const TLDS: Readonly<Record<string, string>> = {
  vom: "com", con: "com", cpm: "com", cmo: "com", ocm: "com", xom: "com", comm: "com", coom: "com", clm: "com", cim: "com", cokm: "com",
  nte: "net", ner: "net", nett: "net",
  ogr: "org", orgg: "org", prg: "org",
};

/** The address's domain typo and the address meant, or null. */
export function addressTypo(address: string | null | undefined): { address: string; suggestion: string; domain: string; meant: string } | null {
  const a = (address ?? "").trim().toLowerCase();
  const at = a.lastIndexOf("@");
  if (at < 1 || at === a.length - 1) return null;
  const local = a.slice(0, at);
  const domain = a.slice(at + 1);
  const provider = PROVIDERS[domain];
  if (provider) return { address: a, suggestion: `${local}@${provider}`, domain, meant: provider };
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 ? domain.slice(dot + 1) : "";
  const fixed = TLDS[tld];
  if (!fixed) return null;
  const meant = `${domain.slice(0, dot)}.${fixed}`;
  return { address: a, suggestion: `${local}@${meant}`, domain, meant };
}

/** Free mail providers: a company match by domain never uses them (two gmail users are not one company). */
export const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "yahoo.com", "icloud.com", "me.com", "mail.ru", "yandex.ru", "proton.me", "protonmail.com", "aol.com", "gmx.de", "gmx.net", "web.de", "qq.com", "163.com", "naver.com"]);
