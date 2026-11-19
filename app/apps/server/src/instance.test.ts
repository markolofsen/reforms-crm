import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { instanceDto } from "@hub/contract/instance";
import { createApp } from "./app";

// GET /api/instance and /api/instance/logo (P48 W0): the brand from config/config.json, read per request.
const BASE = "http://127.0.0.1:4317";
let handle: DbHandle;
let configDir: string;
const configFile = () => join(configDir, "config.json");
const config = (v: Record<string, unknown>) => writeFileSync(configFile(), JSON.stringify(v));
const app = () => createApp(createRepos(handle.db), { instance: { configFile: configFile(), configDir } });
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>';

beforeEach(() => {
  handle = openDb(":memory:");
  configDir = join(mkdtempSync(join(tmpdir(), "hub-brand-")), "config");
  mkdirSync(configDir, { recursive: true });
});
afterEach(() => handle.close());

describe("GET /api/instance", () => {
  it("is Hub with no logo when the config names neither, or does not exist", async () => {
    expect(instanceDto.parse(await (await app().request(`${BASE}/api/instance`)).json())).toEqual({ name: "Hub", hasLogo: false, localOpen: false });
    config({ name: "  ", account: "x" });
    expect(await (await app().request(`${BASE}/api/instance`)).json()).toEqual({ name: "Hub", hasLogo: false, localOpen: false });
    expect((await app().request(`${BASE}/api/instance/logo`)).status).toBe(404);
  });

  it("names the instance and serves its logo (a relative path is read from config/) with its type", async () => {
    writeFileSync(join(configDir, "logo.svg"), SVG);
    config({ name: "Reforms SaaS", logo: "logo.svg" });
    expect(await (await app().request(`${BASE}/api/instance`)).json()).toEqual({ name: "Reforms SaaS", hasLogo: true, localOpen: false });
    const r = await app().request(`${BASE}/api/instance/logo`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/svg+xml");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await r.text()).toBe(SVG);
    const png = join(configDir, "mark.png");
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    config({ name: "R", logo: png });
    expect((await app().request(`${BASE}/api/instance/logo`)).headers.get("content-type")).toBe("image/png");
  });

  it("a logo that is missing or not an image type is 404 and hasLogo false; the reply never holds a path", async () => {
    config({ name: "R", logo: "gone.png" });
    const body = await (await app().request(`${BASE}/api/instance`)).text();
    expect(JSON.parse(body)).toEqual({ name: "R", hasLogo: false, localOpen: false });
    expect(body).not.toContain("gone.png");
    expect((await app().request(`${BASE}/api/instance/logo`)).status).toBe(404);
    writeFileSync(join(configDir, "notes.txt"), "x");
    config({ name: "R", logo: "notes.txt" });
    expect(await (await app().request(`${BASE}/api/instance`)).json()).toEqual({ name: "R", hasLogo: false, localOpen: false });
    expect((await app().request(`${BASE}/api/instance/logo`)).status).toBe(404);
  });

  it("is refused for a foreign host like every route", async () => {
    expect((await app().request("http://evil.example/api/instance")).status).toBe(403);
  });
});
