// The Leads doctor group (P46) against two local HTTP servers: a site and its API on another origin. Nothing leaves 127.0.0.1, and no
// test posts anywhere but the fake API.
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLeadForms } from "../src/leads/config";
import { cspRefuses } from "../src/leads/csp";
import { limits } from "../src/leads/net";
import { measuredDays, NOTION_API } from "../src/leads/silence";
import { registryDomains } from "../src/leads/registry";
import { doctor } from "../src/runner";
import { STEPS } from "../src/steps/index";
import { fake } from "./helpers";

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))); });

async function serve(h: Handler): Promise<string> {
  const s = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => h(req, res, b)); });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

interface SiteOpts { fields?: string[]; csp?: string; script?: string; turnstile?: boolean; pageStatus?: number }
/** A site whose /contact page has a static form and one script; the script names whatever `script` says. */
const site = (o: SiteOpts = {}) => serve((req, res) => {
  if (req.url === "/app.js") { res.end(o.script ?? ""); return; }
  if (req.url !== "/contact") { res.statusCode = 404; res.end(); return; }
  const inputs = (o.fields ?? ["name", "email", "message"]).map((f) => `<input name="${f}">`).join("");
  res.statusCode = o.pageStatus ?? 200;
  if (o.csp) res.setHeader("content-security-policy", o.csp);
  res.end(`<html><body><form>${inputs}</form>${o.turnstile ? '<div class="cf-turnstile" data-sitekey="0xKEY"></div>' : ""}<script src="/app.js"></script></body></html>`);
});

interface ApiLog { posts: { headers: IncomingMessage["headers"]; body: string }[] }
/** The API: GET answers 405 (a POST-only handler); OPTIONS advertises canary support when `canary` is set; POST answers `report`. */
const api = (log: ApiLog, o: { getStatus?: number; canary?: boolean; report?: Record<string, unknown> } = {}) => serve((req, res, body) => {
  if (req.method === "GET") { res.statusCode = o.getStatus ?? 405; res.end(); return; }
  if (req.method === "OPTIONS") { if (o.canary) res.setHeader("x-canary-accept", "v1"); res.statusCode = 200; res.end(); return; }
  log.posts.push({ headers: req.headers, body });
  res.statusCode = 202;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(o.report ?? { stored: true, recipient_ok: true, route_ok: true, id: "r1" }));
});

const SECRET = "canary-shared-secret-0123456789";
function instance(forms: object[], extra: object = {}, secret = true) {
  const f = fake();
  writeFileSync(f.ctx.paths.leadForms, JSON.stringify({ canaryEmail: "canary+{id}@example.com", forms, ...extra }));
  if (secret) {
    mkdirSync(f.ctx.configDir, { recursive: true });
    const p = path.join(f.ctx.configDir, "site-canary");
    writeFileSync(p, SECRET);
    chmodSync(p, 0o600);
  }
  return f;
}
const form = (siteUrl: string, apiUrl: string, over: object = {}) => ({
  id: "contact", domain: "example.com", page: `${siteUrl}/contact`, endpoint: `${apiUrl}/inquiries/submit/`,
  fields: ["name", "email", "message"], honeypot: "website",
  canary: { mode: "signed", secretRef: "site-canary", body: { site: "main" } }, ...over,
});
const run = async (f: ReturnType<typeof fake>) => doctor(f.ctx, STEPS.filter((s) => s.group === "Leads"));
const row = (reports: Awaited<ReturnType<typeof run>>, id: string) => reports.find((r) => r.step.id === id)!;

describe("config/lead-forms.json", () => {
  it("missing is a PASS with no forms; a bad entry names the field", async () => {
    const f = fake();
    expect(loadLeadForms(f.ctx.paths.leadForms).state).toBe("missing");
    const ok = await run(f);
    expect(ok.map((r) => r.outcome)).toEqual(["ok", "ok", "ok"]);
    writeFileSync(f.ctx.paths.leadForms, JSON.stringify({ forms: [{ id: "config", domain: "x", page: "nope", endpoint: "https://a.example/" }] }));
    const l = loadLeadForms(f.ctx.paths.leadForms);
    expect(l.state).toBe("invalid");
    expect(l.state === "invalid" && l.error).toMatch(/forms\.0\.id.*forms\.0\.domain.*forms\.0\.page/);
  });
  it("a signed canary must name its secret file, and the file holds no secret", () => {
    const f = fake();
    writeFileSync(f.ctx.paths.leadForms, JSON.stringify({ forms: [{ id: "a", domain: "example.com", page: "https://example.com/", endpoint: "https://example.com/x", canary: { mode: "signed", secret: "abc" } }] }));
    const l = loadLeadForms(f.ctx.paths.leadForms);
    expect(l.state === "invalid" && l.error).toMatch(/secret/);
  });
});

describe("the GET half", () => {
  it("passes a working form: page, fields, endpoint referenced by the page's script, CSP, endpoint route", async () => {
    const log: ApiLog = { posts: [] };
    const a = await api(log);
    const s = await site({ script: `fetch("${a}/inquiries/submit/")`, csp: `default-src 'self'; connect-src 'self' ${a}` });
    const reports = await run(instance([form(s, a)]));
    const r = row(reports, "leads.contact");
    expect(r.outcome, r.detail).toBe("ok");
    expect(r.detail).toContain("3 fields");
    expect(r.detail).toContain("endpoint GET 405");
    expect(log.posts).toEqual([]);
  });

  it.each([
    ["a missing field", { fields: ["name", "email"] }, {}, /no field message/],
    ["a page that never names the endpoint", { script: "console.log(1)" }, {}, /reference/],
    ["a CSP that blocks the API", { csp: "connect-src 'self'" }, {}, /CSP connect-src does not allow/],
    ["Turnstile configured but absent", {}, { turnstile: true }, /Turnstile is configured but the page has no widget/],
    ["a page that is down", { pageStatus: 503 }, {}, /answered 503/],
  ])("fails on %s and names the cause", async (_n, siteOver: SiteOpts, formOver, re) => {
    const a = await api({ posts: [] });
    const s = await site({ script: `"${a.replace("http://", "")}"`, ...siteOver });
    const r = row(await run(instance([form(s, a, formOver)])), "leads.contact");
    expect(r.outcome).toBe("failed");
    expect(r.detail).toMatch(re);
  });

  it("fails when the endpoint route is gone (404)", async () => {
    const a = await api({ posts: [] }, { getStatus: 404 });
    const s = await site({ script: a });
    const r = row(await run(instance([form(s, a)])), "leads.contact");
    expect(r.outcome).toBe("failed");
    expect(r.detail).toContain("endpoint GET 404");
  });

  it("a client-rendered form skips fields; Turnstile on the page with an allowing CSP passes", async () => {
    const a = await api({ posts: [] });
    const s = await site({ fields: [], script: a, turnstile: true, csp: `script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' ${a}` });
    const r = row(await run(instance([form(s, a, { render: "client", turnstile: { sitekey: "0xKEY" } })])), "leads.contact");
    expect(r.outcome, r.detail).toBe("ok");
    expect(r.detail).toContain("Turnstile widget");
  });

  it("one row per form, checked at the same time", async () => {
    const slow = await serve((req, res) => setTimeout(() => (req.url === "/contact" ? res.end('<input name="name"><input name="email"><input name="message"> /x') : (res.statusCode = 405, res.end())), 400));
    const forms = ["a", "b", "c"].map((id) => form(slow, slow, { id, endpoint: `${slow}/x` }));
    const t0 = Date.now();
    const reports = await run(instance(forms));
    expect(reports.map((r) => r.step.id)).toEqual(["leads.config", "leads.registry", "leads.a", "leads.b", "leads.c"]);
    expect(reports.every((r) => r.outcome === "ok"), reports.map((r) => r.detail).join("\n")).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("--canary", () => {
  const withCanary = (f: ReturnType<typeof fake>) => { f.ctx.canary = true; return f; };

  it("a handler that does not advertise canaries gets no POST: WARN 'canary not supported by endpoint'", async () => {
    const log: ApiLog = { posts: [] };
    const a = await api(log);
    const s = await site({ script: a });
    const r = row(await run(withCanary(instance([form(s, a)]))), "leads.contact");
    expect(r.outcome).toBe("warn");
    expect(r.detail).toContain("canary not supported by endpoint");
    expect(log.posts).toEqual([]);
  });

  it("sends one signed canary with our address, an empty honeypot and the fixed fields; PASS on a full report", async () => {
    const log: ApiLog = { posts: [] };
    const a = await api(log, { canary: true });
    const s = await site({ script: a });
    const r = row(await run(withCanary(instance([form(s, a)]))), "leads.contact");
    expect(r.outcome, r.detail).toBe("ok");
    expect(r.detail).toContain("canary row r1: stored, recipient ok, route ok");
    expect(log.posts).toHaveLength(1);
    const { headers, body } = log.posts[0]!;
    const [ts, mac] = String(headers["x-canary"]).split(".");
    expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(60);
    expect(mac).toBe(createHmac("sha256", SECRET).update(ts!).digest("hex"));
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    const j = JSON.parse(body);
    expect(j).toMatchObject({ email: "canary+contact@example.com", name: "Hub canary", website: "", site: "main" });
    expect(r.detail).not.toContain(SECRET);
  });

  it("fails naming the recipient when the handler would reach nobody", async () => {
    const a = await api({ posts: [] }, { canary: true, report: { stored: true, recipient_ok: false, route_ok: true } });
    const s = await site({ script: a });
    const r = row(await run(withCanary(instance([form(s, a)]))), "leads.contact");
    expect(r.outcome).toBe("failed");
    expect(r.detail).toMatch(/recipient_ok=false.*reach nobody/);
  });

  it("without the secret file the canary is not run, and says so", async () => {
    const log: ApiLog = { posts: [] };
    const a = await api(log, { canary: true });
    const s = await site({ script: a });
    const r = row(await run(withCanary(instance([form(s, a)], {}, false))), "leads.contact");
    expect(r.outcome).toBe("warn");
    expect(r.detail).toContain("canary not run: state/secrets/site-canary is missing");
    expect(log.posts).toEqual([]);
  });
});

describe("registry cross-check", () => {
  it("reads hosts from the first column only", () => {
    expect(registryDomains("| Site | x |\n|---|---|\n| example.com | a |\n| docs.example.com | b |\n| some, words | c |\n")).toEqual(["docs.example.com", "example.com"]);
  });
  it("warns on a registry domain with no form and no none; a none with a reason covers it", async () => {
    const a = await api({ posts: [] });
    const s = await site({ script: a });
    const f = instance([form(s, a)], { registry: "registry.md", none: [{ domain: "docs.example.com", reason: "documentation, no form" }] });
    writeFileSync(path.join(f.ctx.root, "registry.md"), "| Site |\n|---|\n| example.com |\n| docs.example.com |\n| other.example |\n");
    const r = row(await run(f), "leads.registry");
    expect(r.outcome).toBe("warn");
    expect(r.detail).toBe("1 of 3 registry domains have no form and no none: other.example");
  });
});

describe("CSP matching", () => {
  const self = new URL("https://site.example/contact");
  it.each([
    ["connect-src 'self' https://api.site.example", "https://api.site.example/x", undefined],
    ["connect-src https://*.site.example", "https://api.site.example/x", undefined],
    ["default-src 'self'", "https://api.site.example/x", "default-src"],
    ["connect-src api.site.example", "https://api.site.example/x", undefined],
    ["connect-src https:", "https://anything.example/", undefined],
    ["script-src 'self'", "https://api.site.example/x", undefined],
  ])("%s for %s", (csp, target, want) => {
    expect(cspRefuses(csp, "connect-src", new URL(target), self)).toBe(want);
  });
});

describe("network failures (the flaky FAIL of 2026-11-18)", () => {
  const saved = { ...limits };
  beforeEach(() => { limits.requestMs = 300; limits.formMs = 5000; });
  afterEach(() => { Object.assign(limits, saved); });
  const page = (a: string) => `<html><form><input name="name"><input name="email"><input name="message"></form><script src="/app.js"></script></html>`.replace("</html>", `<!-- ${a} --></html>`);

  it("a slow page and slow scripts do not spend the endpoint's budget: each request has its own", async () => {
    // Before 0.12.3: one 300 ms budget for page (200 ms) + script (200 ms) + endpoint, so the endpoint GET started on an aborted signal.
    const a = await api({ posts: [] });
    const s = await serve((req, res) => setTimeout(() => res.end(req.url === "/app.js" ? `"${a}/inquiries/submit/"` : '<input name="name"><input name="email"><input name="message"><script src="/app.js"></script>'), 200));
    const r = row(await run(instance([form(s, a)])), "leads.contact");
    expect(r.outcome, r.detail).toBe("ok");
    expect(r.detail).toContain("endpoint GET 405");
  });

  it("an endpoint that times out once is retried and passes, and says so", async () => {
    let gets = 0;
    const a = await serve((req, res) => { if (req.method === "GET" && ++gets === 1) return; res.statusCode = 405; res.end(); });
    const s = await site({ script: a });
    const r = row(await run(instance([form(s, a)])), "leads.contact");
    expect(r.outcome, r.detail).toBe("ok");
    expect(r.detail).toContain("endpoint GET 405 (on the retry)");
    expect(gets).toBe(2);
  });

  it("a connection reset once is retried", async () => {
    let gets = 0;
    const a = await serve((req, res) => { if (req.method === "GET" && ++gets === 1) { req.socket.destroy(); return; } res.statusCode = 405; res.end(); });
    const s = await site({ script: a });
    const r = row(await run(instance([form(s, a)])), "leads.contact");
    expect(r.outcome, r.detail).toBe("ok");
    expect(gets).toBe(2);
  });

  it("an endpoint that never answers fails after two attempts, with the real error and the real time", async () => {
    const a = await serve(() => {});
    const s = await site({ script: a });
    const r = row(await run(instance([form(s, a)])), "leads.contact");
    expect(r.outcome).toBe("failed");
    expect(r.detail).toMatch(/endpoint .* unreachable: no answer within 0\.3 s, twice \(2 attempts, 0\.[6-9] s\)/);
    expect(r.ms).toBeGreaterThanOrEqual(600);
  });

  it("each row reports its own form's time, not the time left after the first row", async () => {
    const a = await api({ posts: [] });
    const s = await serve((_req, res) => setTimeout(() => res.end(page(a)), 250));
    const reports = await run(instance(["x", "y"].map((id) => form(s, a, { id }))));
    for (const id of ["leads.x", "leads.y"]) expect(row(reports, id).ms, id).toBeGreaterThanOrEqual(250);
  });

  it("a script that cannot be read is named, not taken for a page without the endpoint", async () => {
    const a = await api({ posts: [] });
    const s = await serve((req, res) => { if (req.url === "/app.js") return; res.end(page("nothing")); });
    const r = row(await run(instance([form(s, a)])), "leads.contact");
    expect(r.outcome).toBe("failed");
    expect(r.detail).toMatch(/1 of its scripts could not be read: \/app\.js: no answer within 0\.3 s, twice/);
  });
});

describe("silence (L3)", () => {
  const D = 864e5;
  const now = Date.now();
  async function working() {
    const a = await api({ posts: [] });
    const s = await site({ script: a });
    return { a, s };
  }

  it("the measured threshold is max(14, 3 x the median gap), none below 3 leads", () => {
    expect(measuredDays([now, now - D])).toBeUndefined();
    expect(measuredDays([0, 1, 2, 3].map((i) => now - i * D))).toBe(14);
    expect(measuredDays([0, 10, 20, 30].map((i) => now - i * D))).toBe(30);
  });

  function notionInstance(forms: object[], dates: string[], log: { bodies: unknown[] }) {
    const f = instance(forms);
    const dir = path.join(f.ctx.paths.projects, "desk");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "project.md"), "# Desk\n\n## Settings\n\n| Field | Value | Answered | By |\n|---|---|---|---|\n| schema | 1 | 2026-11-14 | agent |\n| name | Desk | 2026-11-14 | owner |\n\n## Notion databases\n\n- leads: 00000000-0000-4000-8000-0000000000aa\n");
    const tok = path.join(f.ctx.configDir, "notion-token");
    writeFileSync(tok, "secret_notion_token");
    chmodSync(tok, 0o600);
    return serve((req, res, body) => {
      log.bodies.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ results: dates.map((d) => ({ properties: { "Received at": { date: { start: d } } } })), has_more: false }));
    }).then((base) => { const real = f.ctx.fetch; f.ctx.fetch = ((u: string | URL, i?: RequestInit) => real(String(u).replace(NOTION_API, base), i)) as typeof fetch; return f; });
  }

  it("notion-leads: a recent lead by Brand passes; it reads only, with the project's token and the brand filter", async () => {
    const { a, s } = await working();
    const log = { bodies: [] as unknown[] };
    const f = await notionInstance([form(s, a, { silence: { source: "notion-leads", project: "desk", brand: "Acme", form: "lead", days: 14 } })], [new Date(now - 2 * D).toISOString()], log);
    const r = row(await run(f), "leads.contact");
    expect(r.outcome, r.detail).toBe("ok");
    expect(r.detail).toMatch(/silence ok: newest lead 2\.0 d ago, 1 in 90 d, warns after 14 d/);
    expect(log.bodies).toHaveLength(1);
    expect(JSON.stringify(log.bodies[0])).toContain('"contains":"Acme"');
    expect(JSON.stringify(log.bodies[0])).toContain('"equals":"lead"');
    expect(JSON.stringify(log.bodies[0])).toContain("/data_sources/00000000-0000-4000-8000-0000000000aa/query");
    expect(r.detail).not.toContain("secret_notion_token");
  });

  it("notion-leads: a lead older than the threshold is a WARN, never a FAIL", async () => {
    const { a, s } = await working();
    const f = await notionInstance([form(s, a, { silence: { source: "notion-leads", project: "desk", brand: "Acme", days: 14 } })], [new Date(now - 20 * D).toISOString()], { bodies: [] });
    const r = row(await run(f), "leads.contact");
    expect(r.outcome).toBe("warn");
    expect(r.detail).toMatch(/silence: no lead for 20 d \(newest \d{4}-\d\d-\d\d\).*warns after 14 d/);
  });

  it("notion-leads: an unknown project is a WARN that names it", async () => {
    const { a, s } = await working();
    const r = row(await run(instance([form(s, a, { silence: { source: "notion-leads", project: "nobody", brand: "Acme", days: 14 } })])), "leads.contact");
    expect(r.outcome).toBe("warn");
    expect(r.detail).toMatch(/silence not checked .*no such project "nobody"/);
  });

  /** A mail-mcp stand-in: initialize, notification, then one find_messages answered with `dates`. */
  const mailMcp = (dates: string[], calls: unknown[]) => serve((_req, res, body) => {
    const m = JSON.parse(body) as { id?: number; method: string; params?: { name?: string; arguments?: unknown } };
    res.setHeader("content-type", "application/json");
    if (m.method === "tools/call") calls.push(m.params);
    const result = m.method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify({ messages: dates.map((d) => ({ date_received: d, subject: "x" })) }) }] } : {};
    res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id ?? null, result }));
  });

  it("mailbox: measures the threshold from 90 days of notifications and passes a recent one", async () => {
    const { a, s } = await working();
    const calls: unknown[] = [];
    const f = instance([form(s, a, { silence: { source: "mailbox", account: "desk@example.com", mailbox: ["All Mail"], sender: "robot@example.com", subject: "new enquiry" } })]);
    f.ctx.mailUrl = await mailMcp([1, 3, 5, 7].map((i) => new Date(now - i * D).toISOString()), calls);
    const r = row(await run(f), "leads.contact");
    expect(r.outcome, r.detail).toBe("ok");
    expect(r.detail).toMatch(/silence ok: newest lead 1\.0 d ago, 4 in 90 d, warns after 14 d \(measured/);
    expect(calls).toEqual([{ name: "find_messages", arguments: expect.objectContaining({ account: "desk@example.com", mailboxPath: ["All Mail"], sender: "robot@example.com", subject: "new enquiry", limit: 1000 }) }]);
  });

  it("mailbox: too few notifications to measure is a WARN that says what to set", async () => {
    const { a, s } = await working();
    const f = instance([form(s, a, { silence: { source: "mailbox", account: "desk@example.com", subject: "new enquiry" } })]);
    f.ctx.mailUrl = await mailMcp([new Date(now - D).toISOString()], []);
    const r = row(await run(f), "leads.contact");
    expect(r.outcome).toBe("warn");
    expect(r.detail).toMatch(/1 lead\(s\) in 90 d .* under one a month/);
  });

  it("a mailbox source without sender or subject does not parse", () => {
    const f = instance([{ id: "a", domain: "example.com", page: "https://example.com/", endpoint: "https://example.com/x", canary: { mode: "none" }, silence: { source: "mailbox", days: 14 } }]);
    const l = loadLeadForms(f.ctx.paths.leadForms);
    expect(l.state === "invalid" && l.error).toMatch(/sender or subject/);
  });
});
