import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { bareScoped, proxy } from "../src/proxy";

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

  it("passes a project's address, a projectless page and the entry untouched (P48: the shell frame writes the canonical address)", () => {
    const go = (path: string, cookie: string | undefined) => call("127.0.0.1:5173", { path, cookie });
    for (const path of ["/lisbon/mail", "/lisbon/mail/c/id-42?filter=all", "/overview", "/help", "/settings/connections", "/settings/mac", "/"]) expect(passes(go(path, "hub_project=lisbon")), path).toBe(true);
  });

  it("serves a bare scoped address from the one tree: a rewrite to the `_` segment, never a redirect (P127 A2)", () => {
    for (const [path, inside] of [
      ["/mail", "/_/mail"],
      ["/mail/c/id-42?filter=all", "/_/mail/c/id-42?filter=all"],
      ["/mail?project=lisbon", "/_/mail?project=lisbon"],
      ["/settings", "/_/settings"],
      ["/settings/agent", "/_/settings/agent"],
      ["/settings/messengers", "/_/settings/messengers"],
    ] as const) {
      const res = call("127.0.0.1:5173", { path, cookie: "hub_project=lisbon" });
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
      expect(new URL(res.headers.get("x-middleware-rewrite") ?? "").pathname + new URL(res.headers.get("x-middleware-rewrite") ?? "").search, path).toBe(inside);
    }
  });

  it("rewrites only the bare scoped heads", () => {
    expect(bareScoped("/log")).toBe("/_/log");
    expect(bareScoped("/knowledge")).toBe("/_/knowledge");
    for (const path of ["/", "/overview", "/help", "/settings/connections", "/settings/mac", "/lisbon/mail", "/api/x", "/health", "/_/mail"]) expect(bareScoped(path), path).toBeNull();
  });

  it("still refuses a foreign Host before it rewrites", () => {
    expect(call("evil.test", { path: "/mail" }).status).toBe(403);
  });
});

// P121 T4: one e2e build, one `next start` per worker; only `HUB_E2E_RUNTIME_API=1` moves `/api` to the process's own port.
describe("the e2e runtime API (HUB_E2E_RUNTIME_API)", () => {
  const withEnv = (env: Record<string, string | undefined>, run: () => void) => {
    const before = { flag: process.env.HUB_E2E_RUNTIME_API, port: process.env.HUB_PORT };
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    try {
      run();
    } finally {
      for (const [k, v] of Object.entries({ HUB_E2E_RUNTIME_API: before.flag, HUB_PORT: before.port })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
  it("is off by default: /api passes to the next.config rewrite", () => {
    withEnv({ HUB_E2E_RUNTIME_API: undefined, HUB_PORT: "4500" }, () => expect(passes(call("127.0.0.1:5199", { path: "/api/x?a=1" }))).toBe(true));
  });
  it("sends /api to HUB_PORT, keeping the path and query", () => {
    withEnv({ HUB_E2E_RUNTIME_API: "1", HUB_PORT: "4500" }, () => {
      expect(call("127.0.0.1:5200", { path: "/api/x?a=1" }).headers.get("x-middleware-rewrite")).toBe("http://127.0.0.1:4500/api/x?a=1");
    });
  });
  it("leaves pages alone and still guards the Host first", () => {
    withEnv({ HUB_E2E_RUNTIME_API: "1", HUB_PORT: "4500" }, () => {
      expect(call("127.0.0.1:5200", { path: "/" }).headers.get("x-middleware-rewrite")).toBeNull();
      expect(call("evil.test", { path: "/api/x" }).status).toBe(403);
    });
  });
});
