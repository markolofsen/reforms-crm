import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

// `link_fetch`'s fetcher (owner 2026-11-25: the agent opens a link a client sent, a photo on media.carapis.com in a bug
// report). It runs in `hub mcp`, outside the session's OS sandbox (a command there has no network), so it is the only door
// and it refuses anything but a public http(s) address: no localhost, no private, link-local, CGNAT or multicast range, no
// file:, no credentials in the URL. Every address a name resolves to is checked at connect time (the socket's own lookup), so
// a name that resolves to 127.0.0.1 (rebinding) is refused too; a redirect is followed only to another public http(s) URL.

/** At most this many bytes are read; an image above it is refused, a page is cut. */
export const LINK_MAX_BYTES = 5 * 1024 * 1024;
export const LINK_TIMEOUT_MS = 15_000;
export const LINK_MAX_REDIRECTS = 3;
export const LINK_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96]] as const) PRIVATE.addSubnet(net, bits, "ipv6");

/** Whether an IP literal is a public unicast address (an IPv4-mapped IPv6 address is judged as its IPv4). */
export function isPublicAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  const v = mapped ?? ip;
  const family = isIP(v);
  if (family === 0) return false;
  return !PRIVATE.check(v, family === 4 ? "ipv4" : "ipv6");
}

export class LinkRefused extends Error {
  constructor(readonly why: string) {
    super(why);
    this.name = "LinkRefused";
  }
}

/** The URL if it may be fetched: http(s), no credentials, a host that is not an IP literal of a private range or `localhost`. */
export function checkLinkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new LinkRefused("not a URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new LinkRefused(`${u.protocol} is not fetched: only a public http(s) link`);
  if (u.username || u.password) throw new LinkRefused("a link with a user name or password is not fetched");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new LinkRefused(`${host} is a local name`);
  if (isIP(host) && !isPublicAddress(host)) throw new LinkRefused(`${host} is not a public address`);
  return u;
}

/** The socket's lookup: every address of the name must be public, else the connection fails with LinkRefused. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad || !addresses.length) return callback(new LinkRefused(`${hostname} resolves to ${bad?.address ?? "nothing"}, not a public address`), "", 0);
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
};

export interface LinkResponse {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  /** The body was longer than {@link LINK_MAX_BYTES} and was cut. */
  cut: boolean;
}

export type LinkFetch = (url: string) => Promise<LinkResponse>;

function getOnce(u: URL): Promise<{ status: number; location: string | null; contentType: string; body: Buffer; cut: boolean }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.get(u, { lookup: publicLookup, timeout: LINK_TIMEOUT_MS, headers: { "user-agent": "Hub link_fetch", accept: "image/*,text/html,text/plain,application/json;q=0.9,*/*;q=0.5" } }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let cut = false;
      res.on("data", (c: Buffer) => {
        if (cut) return;
        size += c.length;
        if (size > LINK_MAX_BYTES) {
          cut = true;
          chunks.push(c.subarray(0, c.length - (size - LINK_MAX_BYTES)));
          res.destroy();
          resolve({ status: res.statusCode ?? 0, location: null, contentType: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks), cut });
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, location: typeof res.headers.location === "string" ? res.headers.location : null, contentType: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks), cut }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`no answer in ${LINK_TIMEOUT_MS / 1000} s`)));
    req.on("error", reject);
  });
}

/** GET a public link, following at most {@link LINK_MAX_REDIRECTS} redirects, each one checked again. */
export const fetchPublicLink: LinkFetch = async (raw) => {
  let u = checkLinkUrl(raw);
  for (let hop = 0; ; hop++) {
    const r = await getOnce(u);
    if (r.status >= 300 && r.status < 400 && r.location) {
      if (hop >= LINK_MAX_REDIRECTS) throw new LinkRefused(`more than ${LINK_MAX_REDIRECTS} redirects`);
      u = checkLinkUrl(new URL(r.location, u).toString());
      continue;
    }
    return { url: u.toString(), status: r.status, contentType: r.contentType.split(";")[0]!.trim().toLowerCase(), body: r.body, cut: r.cut };
  }
};

/** A page's readable text: no script, style or tags, entities of the common five decoded, whitespace collapsed. */
export function pageText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null;
  const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const text = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(br|p|div|li|h[1-6]|tr|title)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return { title: title ? decode(title).replace(/\s+/g, " ").trim() : null, text: decode(text).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim() };
}
