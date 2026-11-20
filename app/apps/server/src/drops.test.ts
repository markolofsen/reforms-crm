import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dropFolder, hubPaths, type HubPaths } from "@hub/config/paths";
import { DROP_FIELD, DROP_LIMITS } from "@hub/contract/terminal";
import type { Repos } from "@hub/db";
import type { PtyProcess, PtySpawn } from "@hub/terminal";
import { cliDetector } from "@hub/agent/detect";
import { ticketStore } from "./admin-gate";
import { createApp } from "./app";
import { numbered, safeName, SAFE_NAME_MAX } from "./drops";
import { createTerminal } from "./terminal";

// P76, decision 0041: a file dropped on a tab is copied under state/drops and its path answered. A fake PTY: no shell starts.

const ADMIN_PORT = 5173;
const API = "http://127.0.0.1:4317";
const SAME = { host: "127.0.0.1:4317", origin: `http://127.0.0.1:${ADMIN_PORT}`, "sec-fetch-site": "same-origin" };
const repos = { projects: { get: async (s: string) => (s === "acme" ? { slug: "acme" } : null) } } as unknown as Repos;

let home: string;
let paths: HubPaths;
let exits: Array<(e: { exitCode: number | null }) => void>;

const spawn: PtySpawn = () => {
  const p: PtyProcess = { pid: 7, onData: () => {}, onExit: (cb) => { exits.push(cb); }, write: () => {}, resize: () => {}, kill: () => {}, pause: () => {}, resume: () => {} };
  return p;
};

function setup() {
  const detector = cliDetector({ detect: async () => [] });
  const terminal = createTerminal({ paths, repos, adminPort: ADMIN_PORT, apiPort: 4317, spawn, fakeShell: false, env: { SHELL: "/bin/zsh" }, nodeBin: "/n/node", tickets: ticketStore({ ttlMs: 30_000 }), detector });
  const app = createApp(repos, { terminal, adminPort: ADMIN_PORT });
  const start = async (body: Record<string, string>) => {
    const r = await app.request(`${API}/api/terminal/sessions`, { method: "POST", headers: { ...SAME, "content-type": "application/json" }, body: JSON.stringify(body) });
    return ((await r.json()) as { id: string }).id;
  };
  const drop = (id: string, files: Array<[string, Uint8Array | string]>, headers: Record<string, string> = SAME) => {
    const form = new FormData();
    for (const [name, bytes] of files) form.append(DROP_FIELD, new File([bytes], name));
    return app.request(`${API}/api/terminal/sessions/${id}/drops`, { method: "POST", headers, body: form });
  };
  return { terminal, app, start, drop };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hub-server-drops-"));
  mkdirSync(join(home, "config"), { recursive: true });
  paths = hubPaths({ home, env: {} });
  exits = [];
});

describe("the safe name: the only name on disk", () => {
  it.each([
    ["Скриншот 2026-11-20 в 10.15.png", "Скриншот-2026-11-20-в-10.15.png"],
    ["My File (1).PNG", "My-File-1-.PNG"],
    ["../../etc/passwd", "passwd"],
    ["..\\..\\boot.ini", "boot.ini"],
    [".env", "env"],
    ["..", "file"],
    ["", "file"],
    ["$(rm -rf ~);`x`.txt", "rm-rf-x-.txt"],
    ["á.txt", "á.txt"],
    ["--help", "help"],
  ])("%j becomes %j", (raw, safe) => expect(safeName(raw)).toBe(safe));
  it("300 characters are cut to the cap, the extension kept", () => {
    const s = safeName(`${"x".repeat(300)}.png`);
    expect(Array.from(s)).toHaveLength(SAFE_NAME_MAX);
    expect(s.endsWith(".png")).toBe(true);
  });
  it("a clash is numbered before the extension", () => {
    expect(numbered("a.png", 1)).toBe("a.png");
    expect(numbered("a.png", 2)).toBe("a-2.png");
    expect(numbered("README", 3)).toBe("README-3");
  });
});

describe("POST /api/terminal/sessions/:id/drops", () => {
  it("writes each file under state/drops/<project>/<session>/ (700, files 600) and answers the absolute paths in order; a clash is numbered", async () => {
    const { start, drop } = setup();
    const id = await start({ preset: "claude", project: "acme" });
    const r = await drop(id, [["My shot.png", "PNG1"], ["notes.md", "# n"], ["My shot.png", "PNG2"]]);
    expect(r.status).toBe(201);
    const dir = dropFolder(paths, "acme", id);
    const { paths: got } = (await r.json()) as { paths: string[] };
    expect(got).toEqual([join(dir, "My-shot.png"), join(dir, "notes.md"), join(dir, "My-shot-2.png")]);
    expect(readFileSync(got[0]!, "utf8")).toBe("PNG1");
    expect(readFileSync(got[2]!, "utf8")).toBe("PNG2");
    expect(statSync(got[0]!).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
  it("a Shell tab's drops go under _shell", async () => {
    const { start, drop } = setup();
    const id = await start({ preset: "shell" });
    const { paths: got } = (await (await drop(id, [["a.txt", "a"]])).json()) as { paths: string[] };
    expect(got[0]).toBe(join(dropFolder(paths, null, id), "a.txt"));
  });
  it("11 files, or more than 20 MiB in all, are refused and nothing is written", async () => {
    const { start, drop } = setup();
    const id = await start({ preset: "claude", project: "acme" });
    const eleven = Array.from({ length: DROP_LIMITS.files + 1 }, (_, i): [string, string] => [`f${i}.txt`, "x"]);
    expect((await drop(id, eleven)).status).toBe(413);
    const big = new Uint8Array(DROP_LIMITS.bytes / 2 + 1);
    const r = await drop(id, [["a.bin", big], ["b.bin", big]]);
    expect(r.status).toBe(413);
    expect(((await r.json()) as { code: string }).code).toBe("invalid");
    expect(existsSync(dropFolder(paths, "acme", id))).toBe(false);
  });
  it("no file is 400", async () => {
    const { start, drop } = setup();
    const id = await start({ preset: "shell" });
    expect((await drop(id, [])).status).toBe(400);
  });
  it("a foreign Origin and a missing Sec-Fetch-Site are 403; nothing is written", async () => {
    const { start, drop } = setup();
    const id = await start({ preset: "shell" });
    expect((await drop(id, [["a.txt", "a"]], { ...SAME, origin: "http://127.0.0.1:9999" })).status).toBe(403);
    const { "sec-fetch-site": _, ...noSite } = SAME;
    expect((await drop(id, [["a.txt", "a"]], noSite)).status).toBe(403);
    expect(existsSync(paths.drops)).toBe(false);
  });
  it("an unknown session is 404, an ended one 409", async () => {
    const { start, drop } = setup();
    expect((await drop("nope", [["a.txt", "a"]])).status).toBe(404);
    const id = await start({ preset: "shell" });
    exits[0]!({ exitCode: 0 });
    const r = await drop(id, [["a.txt", "a"]]);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe("wrong_state");
  });
  it("closing the tab removes its folder and leaves the others'; stop and server start empty state/drops", async () => {
    const { terminal, start, drop, app } = setup();
    const a = await start({ preset: "claude", project: "acme" });
    const b = await start({ preset: "shell" });
    await drop(a, [["a.txt", "a"]]);
    await drop(b, [["b.txt", "b"]]);
    expect((await app.request(`${API}/api/terminal/sessions/${a}`, { method: "DELETE", headers: SAME })).status).toBe(200);
    expect(existsSync(dropFolder(paths, "acme", a))).toBe(false);
    expect(readdirSync(dropFolder(paths, null, b))).toEqual(["b.txt"]);
    terminal.stop();
    expect(existsSync(paths.drops)).toBe(false);
    mkdirSync(dropFolder(paths, "acme", "old"), { recursive: true });
    writeFileSync(join(dropFolder(paths, "acme", "old"), "x"), "x");
    setup().terminal.warm();
    expect(existsSync(paths.drops)).toBe(false);
  });
});
