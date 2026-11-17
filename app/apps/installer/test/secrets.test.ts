import { statSync, writeFileSync, chmodSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mailSteps } from "../src/steps/mail.ts";
import { notionSteps } from "../src/steps/notion.ts";
import path from "node:path";
import { fileState, redact, storeToken } from "@hub/connections";
import { parseRpc } from "../src/mcp-probe.ts";
import { fake } from "./helpers.ts";

const TOKEN = "ntn\u005fTESTTOKENVALUE1234567890";

describe("secrets", () => {
  it("stored with mode 600, a loose mode is reported, values are redacted", () => {
    const f = fake();
    const dir = f.ctx.configDir;
    const file = path.join(dir, "notion-token");
    expect(fileState(dir, "notion-token").state).toBe("missing");
    storeToken(dir, "notion-token", TOKEN);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(fileState(dir, "notion-token").state).toBe("stored");
    expect(JSON.stringify(fileState(dir, "notion-token"))).not.toContain(TOKEN);
    expect(redact(dir, `failed with ${TOKEN} here`)).toBe("failed with *** here");
    chmodSync(file, 0o644);
    expect(fileState(dir, "notion-token")).toMatchObject({ state: "unsafe-mode", mode: "644" });
  });
});

describe("notion and mail checks", () => {
  it("notion: missing token fails; 404 explains the sharing step; 200 passes; token never in detail", async () => {
    const f = fake();
    const s = notionSteps[0]!;
    expect((await s.check(f.ctx)).level).toBe("fail");
    storeToken(f.ctx.configDir, "notion-token", "ntn\u005fTESTTOKENVALUE123456");
    for (const [status, level] of [[500, "fail"], [200, "pass"], [401, "fail"]] as const) {
      f.ctx.fetch = (async (url: string, init: any) => {
        expect(String(url)).toContain("/v1/users/me");
        expect(init.headers.authorization).toContain("Bearer");
        return new Response("{}", { status });
      }) as any;
      const r = await s.check(f.ctx);
      expect(r.level).toBe(level);
      expect(r.detail).not.toContain("ntn\u005f");
    }
  });
  it("mail: empty account is a clear failure; account found and message read passes", async () => {
    const f = fake();
    const s = mailSteps.find((x) => x.id === "mail.account")!;
    writeFileSync(`${f.root}/config/config.json`, JSON.stringify({ account: "" }));
    expect((await s.check(f.ctx)).detail).toContain("account");
    writeFileSync(`${f.root}/config/config.json`, JSON.stringify({ account: "me@x.example", mailboxes: ["INBOX"] }));
    const rpc = (id: number, text: string) => `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } })}\n\n`;
    f.ctx.fetch = (async (_u: string, init: any) => {
      const b = JSON.parse(init.body);
      if (b.method === "initialize") return new Response(rpc(1, ""), { headers: { "mcp-session-id": "s" } });
      if (!b.id) return new Response("", { status: 202 });
      return new Response(rpc(b.id, b.params.name === "list_accounts" ? "me@x.example" : "[{id:1}]"));
    }) as any;
    expect((await s.check(f.ctx)).level).toBe("pass");
  });
  it("parses SSE and plain JSON-RPC", () => {
    expect(parseRpc('event: message\ndata: {"a":1}\n\n')).toEqual({ a: 1 });
    expect(parseRpc('{"a":2}')).toEqual({ a: 2 });
  });
});
