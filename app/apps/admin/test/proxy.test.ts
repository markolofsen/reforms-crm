import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../src/proxy";

const call = (host: string, init: { method?: string; origin?: string; path?: string; cookie?: string } = {}) => {
  const headers = new Headers({ host });
  if (init.origin !== undefined) headers.set("origin", init.origin);
  if (init.cookie !== undefined) headers.set("cookie", init.cookie);
  return proxy(new NextRequest(`http://${host}${init.path ?? "/api/x"}`, { method: init.method ?? "GET", headers }));
};
const passes = (res: Response) => res.status === 200 && res.headers.get("x-middleware-next") === "1";

describe("proxy (Host and Origin guard)", () => {
  it("lets loopback names through", () => {
    for (const host of ["127.0.0.1:5173", "localhost:5173", "[::1]:5173"]) expect(passes(call(host)), host).toBe(true);
  });
  it("refuses a foreign Host with 403, including a loopback lookalike", async () => {
    for (const host of ["evil.test", "evil.test:5173", "127.0.0.1.evil.test", ""]) {
      const res = call(host);
      expect(res.status, host).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden host", code: "forbidden" });
    }
  });
  it("refuses a mutating call with a foreign or null Origin, allows a loopback or absent one", async () => {
    for (const origin of ["http://evil.test", "null"]) {
      const res = call("127.0.0.1:5173", { method: "POST", origin });
      expect(res.status, origin).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden origin", code: "forbidden" });
    }
    expect(passes(call("127.0.0.1:5173", { method: "POST", origin: "http://localhost:5173" }))).toBe(true);
    expect(passes(call("127.0.0.1:5173", { method: "POST" }))).toBe(true);
  });
  it("does not judge the Origin of a read", () => {
    expect(passes(call("127.0.0.1:5173", { method: "GET", origin: "http://evil.test" }))).toBe(true);
  });

  it("puts the remembered project into a bare project-scoped address, first, and keeps the rest", () => {
    const go = (path: string, cookie: string | undefined) => call("127.0.0.1:5173", { path, cookie });
    const to = (res: Response) => new URL(res.headers.get("location") ?? "http://none").pathname + new URL(res.headers.get("location") ?? "http://none").search;
    expect(to(go("/drafts", "hub_project=lisbon"))).toBe("/drafts?project=lisbon");
    expect(go("/drafts", "hub_project=lisbon").status).toBe(307);
    expect(to(go("/drafts/42?filter=hold", "hub_project=demo%20shop"))).toBe("/drafts/42?project=demo+shop&filter=hold");
    expect(to(go("/bulk", "hub_project=lisbon"))).toBe("/bulk?project=lisbon");
  });
  it("leaves an addressed project, Overview, the entry, the API and a missing cookie alone", () => {
    const go = (path: string, cookie: string | undefined) => call("127.0.0.1:5173", { path, cookie });
    expect(passes(go("/drafts?project=other", "hub_project=lisbon"))).toBe(true);
    expect(passes(go("/overview", "hub_project=lisbon"))).toBe(true);
    expect(passes(go("/", "hub_project=lisbon"))).toBe(true);
    expect(passes(go("/api/drafts", "hub_project=lisbon"))).toBe(true);
    expect(passes(go("/drafts", undefined))).toBe(true);
    expect(passes(go("/drafts", "hub_project="))).toBe(true);
    expect(passes(call("127.0.0.1:5173", { path: "/drafts", cookie: "hub_project=lisbon", method: "POST" }))).toBe(true);
  });
});
