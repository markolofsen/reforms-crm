import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { adminLoopbackCheck } from "../src/steps/admin";
import { fake } from "./helpers";

const open: Server[] = [];
const listen = (host: string) => new Promise<number>((resolve) => {
  const s = createServer((_, res) => res.end("ok"));
  open.push(s);
  s.listen(0, host, () => resolve((s.address() as AddressInfo).port));
});
afterEach(() => { for (const s of open.splice(0)) s.close(); });

describe("hub doctor: the admin listens on loopback only", () => {
  it("passes when nothing listens (hub up starts it)", async () => {
    const port = await listen("127.0.0.1");
    open.pop()!.close();
    expect((await adminLoopbackCheck(fake().ctx, port)).level).toBe("pass");
  });
  it("passes for a listener on 127.0.0.1 that answers", async () => {
    const r = await adminLoopbackCheck(fake().ctx, await listen("127.0.0.1"));
    expect(r.level).toBe("pass");
    expect(r.detail).toContain("loopback only");
  });
  it("fails for a listener on every interface", async () => {
    const r = await adminLoopbackCheck(fake().ctx, await listen("0.0.0.0"));
    expect(r.level).toBe("fail");
    expect(r.detail).toContain("not on 127.0.0.1 only");
  });
});
