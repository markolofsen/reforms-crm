import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, openDb, openOwnFile, publicPhotoBackupReferences } from "@hub/db";
import { watchPhotoFolder } from "@hub/config/paths";
import type { PublicPhotoAsset } from "@hub/contract/watch-media";
import { watchPolicyFile, type WatchPolicy } from "@hub/watch/policy";
import { backup } from "../src/commands/backup/snapshot";
import { checkManifest, MANIFEST, readManifest, stampOf } from "../src/commands/backup/manifest";
import { verify, restoreSnapshotDb } from "../src/commands/backup/verify";
import { checkWatchBackup } from "../src/commands/backup/watch-verify";
import { copyWatchBackupFiles, watchBackupFiles } from "../src/commands/backup/watch-files";
import { fake } from "./helpers";

const NOW = new Date("2026-11-27T10:00:00.000Z");
const PROJECT = "acme.support";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/ACJozP8EXAJW4ArPbwAAAABJRU5ErkJggg==", "base64");
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const PHOTO: PublicPhotoAsset = { kind: "photo", blobRef: hash(PNG) + ".png", sha256: hash(PNG), mime: "image/png", bytes: PNG.length, width: 1, height: 1 };
const STRATEGY = "# Reviewed strategy\nOnly an exact separately reviewed reply is permitted.\n";
const SECRET = "credential-sentinel-must-not-be-copied";
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const put = (file: string, bytes: string | Buffer) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, bytes); };

async function setup() {
  const f = fake({ run: (call) => call.cmd === "git" ? { code: 128, stdout: "", stderr: "not a repository" } : undefined });
  temporary.push(path.dirname(f.root));
  const { ctx } = f;
  put(ctx.paths.configFile, "{}");
  const project = path.join(ctx.paths.projects, PROJECT);
  put(path.join(project, "project.md"), "# Acme\n\n## Settings\n\n| Field | Value | Answered | By |\n|---|---|---|---|\n| schema | 1 | 2026-11-27 | owner |\n| status | active | 2026-11-27 | owner |\n| mail.accounts | owner@example.test | 2026-11-27 | owner |\n");
  const asset = path.join(watchPhotoFolder(ctx.paths, PROJECT), PHOTO.blobRef);
  const strategy = path.join(project, "reports", "cmdop-discussions", "strategy.md");
  const policyFile = watchPolicyFile(ctx.paths.stateProjects, PROJECT);
  put(asset, PNG); put(strategy, STRATEGY);
  const policy: WatchPolicy = { version: 1, revision: 2, enabled: true, account: "123456",
    approval: { requestRef: "owner-request", approvedAt: NOW.toISOString() },
    directions: { support: { groups: ["acme_chat"], join: true, reply: true, photoReplies: true,
      strategy: { path: "reports/cmdop-discussions/strategy.md", sha256: hash(STRATEGY) } } },
    limits: { joinsPerDay: 3, repliesPerDay: 3 } };
  put(policyFile, JSON.stringify(policy));
  mkdirSync(path.dirname(ctx.paths.db), { recursive: true });
  const h = openDb(ctx.paths.db);
  try {
    const repos = createRepos(h.db);
    const p = await repos.sends.createPublicProposal({ id: "a".repeat(64), project: PROJECT, direction: "support",
      account: "123456", groupUsername: "acme_chat", chatId: -1001234567890, accessHash: "1234", replyToMessageId: 42,
      threadId: null, targetKey: "one-physical-source", text: "An exact photo.", textHash: hash("An exact photo."),
      payloadHash: "b".repeat(64), photo: PHOTO, sourceHash: "c".repeat(64), sourceAt: NOW.toISOString(),
      rulesHash: "d".repeat(64), policyGeneration: "generation", policyRevision: 2, strategyHash: hash(STRATEGY),
      reviewRef: "external-review", reviewedAt: NOW.toISOString(), createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 1_800_000).toISOString(), randomId: "123456789" });
    await repos.sends.preparePublicPhoto({ proposalId: p.id, project: PROJECT, account: p.account, assetHash: PHOTO.sha256,
      photoId: "9001", accessHash: "987654", fileReference: "AQID", createdAt: NOW.toISOString() });
  } finally { h.close(); }
  const root = path.join(ctx.paths.home, "backups");
  return { ctx, root, asset, project, strategy, policyFile, policy, snapshot: path.join(root, stampOf(NOW)) };
}
const photoKey = `projects/${PROJECT}/assets/watch-replies/${PHOTO.blobRef}`;
const policyKey = `state/projects/${PROJECT}/watch-policy.json`;
const strategyKey = `projects/${PROJECT}/reports/cmdop-discussions/strategy.md`;

describe("public photo workflow recovery in the ordinary snapshot", () => {
  it("plans without writes, copies only allowlisted bytes, and verifies a complete copied DB/asset/policy/strategy set", async () => {
    const s = await setup();
    put(path.join(s.ctx.configDir, "telegram-session"), SECRET);
    put(path.join(s.ctx.paths.stateProjects, PROJECT, "private-session.json"), SECRET);
    put(path.join(s.ctx.paths.state, "drops", PROJECT, "terminal", "dropped.png"), SECRET);
    put(path.join(s.project, "reports", "unrelated.md"), SECRET);
    put(path.join(watchPhotoFolder(s.ctx.paths, PROJECT), "not-content-addressed.png"), SECRET);
    put(path.join(watchPhotoFolder(s.ctx.paths, PROJECT), ".import-pending"), SECRET);
    const beforePolicy = readFileSync(s.policyFile);
    const dry = await backup(s.ctx, { apply: false, now: NOW });
    expect(dry.ok, dry.lines.join("\n")).toBe(true);
    expect(dry.lines.join("\n")).toContain(photoKey);
    expect(existsSync(s.root)).toBe(false);
    const result = await backup(s.ctx, { apply: true, now: NOW });
    expect(result.ok, result.lines.join("\n")).toBe(true);
    const manifest = readManifest(s.snapshot);
    if (!manifest) throw new Error("snapshot manifest missing");
    expect(manifest.files.map((file) => file.path).sort()).toEqual(["config/config.json", "data/app.db", photoKey, strategyKey, policyKey].sort());
    expect(manifest.files.find((file) => file.path === photoKey)).toMatchObject({ sha256: PHOTO.sha256, size: PNG.length });
    for (const file of manifest.files) expect(readFileSync(path.join(s.snapshot, file.path)).includes(SECRET)).toBe(false);
    expect(readFileSync(path.join(s.snapshot, photoKey))).toEqual(PNG);
    expect(readFileSync(path.join(s.snapshot, policyKey))).toEqual(beforePolicy);
    expect(publicPhotoBackupReferences(path.join(s.snapshot, "data", "app.db"))).toEqual([{ project: PROJECT, photo: PHOTO }]);
    expect(verify(s.ctx, s.snapshot)).toMatchObject({ ok: true });
    expect(readFileSync(s.policyFile)).toEqual(beforePolicy);
    expect(readdirSync(path.join(s.snapshot, "data"))).toEqual(["app.db"]);
  });

  it("round-trips only the bounded opaque account journal and refuses source or snapshot journal links", async () => {
    const s = await setup();
    const journal = path.join(s.ctx.paths.watch, "_accounts.json");
    const bytes = Buffer.from('{"opaqueCounters":{"joins":2},"floodUntil":"2026-11-27T12:00:00Z"}\n');
    put(journal, bytes);
    put(journal + ".lock", SECRET);
    const result = await backup(s.ctx, { apply: true, now: NOW });
    expect(result.ok, result.lines.join("\n")).toBe(true);
    const manifest = readManifest(s.snapshot);
    if (!manifest) throw new Error("manifest missing");
    const key = "data/watch/_accounts.json";
    expect(manifest.files.filter((file) => file.path.startsWith("data/watch/")).map((file) => file.path)).toEqual([key]);
    expect(manifest.files.find((file) => file.path === key)).toMatchObject({ size: bytes.length, sha256: hash(bytes) });
    expect(readFileSync(path.join(s.snapshot, key))).toEqual(bytes);
    expect(verify(s.ctx, s.snapshot).ok).toBe(true);
    expect(readFileSync(journal)).toEqual(bytes);
    const outside = path.join(s.ctx.paths.home, "outside-accounts.json");
    put(outside, bytes); unlinkSync(journal); symlinkSync(outside, journal);
    const later = new Date(NOW.getTime() + 1_000);
    const linked = await backup(s.ctx, { apply: false, now: later });
    expect(linked.ok).toBe(false);
    expect(linked.lines.join("\n")).toContain("symbolic links");
    unlinkSync(journal); writeFileSync(journal, Buffer.alloc(65_537));
    const oversized = await backup(s.ctx, { apply: false, now: later });
    expect(oversized.ok).toBe(false);
    expect(oversized.lines.join("\n")).toContain("65536");
    const copied = path.join(s.snapshot, key);
    unlinkSync(copied); symlinkSync(outside, copied);
    expect(restoreSnapshotDb(s.snapshot, manifest).problems.join("; ")).toContain("symbolic links");
    expect(verify(s.ctx, s.snapshot).ok).toBe(false);
  });

  it.each(["missing", "changed", "symlink", "oversized"])("refuses a %s photo including a dangling copied-DB reference and removes the partial snapshot", async (change) => {
    const s = await setup();
    if (change === "missing") unlinkSync(s.asset);
    if (change === "changed") writeFileSync(s.asset, Buffer.concat([PNG, Buffer.from([0])]));
    if (change === "oversized") writeFileSync(s.asset, Buffer.alloc(8 * 1024 * 1024 + 1));
    if (change === "symlink") {
      const outside = path.join(s.ctx.paths.home, "outside.png");
      put(outside, PNG); unlinkSync(s.asset); symlinkSync(outside, s.asset);
    }
    const result = await backup(s.ctx, { apply: true, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toMatch(/missing|digest|symbolic|regular file/);
    expect(existsSync(s.snapshot)).toBe(false);
    expect(existsSync(s.snapshot + ".partial")).toBe(false);
  });

  it.each(["missing", "changed", "symlink", "outside", "oversized", "invalid-policy"])("refuses a %s policy/strategy pin without reading unrelated files", async (change) => {
    const s = await setup();
    if (change === "missing") unlinkSync(s.strategy);
    if (change === "changed") writeFileSync(s.strategy, "changed strategy");
    if (change === "oversized") writeFileSync(s.strategy, Buffer.alloc(1_048_577));
    if (change === "symlink") {
      const outside = path.join(s.ctx.paths.home, "outside.md");
      put(outside, STRATEGY); unlinkSync(s.strategy); symlinkSync(outside, s.strategy);
    }
    if (change === "outside") {
      const direction = s.policy.directions.support;
      if (!direction?.strategy) throw new Error("fixture pin missing");
      direction.strategy.path = "../outside.md";
      put(path.join(s.ctx.paths.projects, "outside.md"), STRATEGY);
      writeFileSync(s.policyFile, JSON.stringify(s.policy));
    }
    if (change === "invalid-policy") writeFileSync(s.policyFile, "{");
    const result = await backup(s.ctx, { apply: true, now: NOW });
    expect(result.ok).toBe(false);
    expect(existsSync(s.snapshot)).toBe(false);
    expect(existsSync(s.snapshot + ".partial")).toBe(false);
  });

  it("refuses a linked asset directory and a linked protected policy file", async () => {
    const s = await setup();
    const outside = path.join(s.ctx.paths.home, "outside-assets");
    put(path.join(outside, PHOTO.blobRef), PNG);
    rmSync(path.dirname(s.asset), { recursive: true });
    symlinkSync(outside, path.dirname(s.asset));
    expect((await backup(s.ctx, { apply: false, now: NOW })).ok).toBe(false);
    unlinkSync(path.dirname(s.asset)); put(s.asset, PNG);
    const outsidePolicy = path.join(s.ctx.paths.home, "outside-policy.json");
    put(outsidePolicy, JSON.stringify(s.policy)); unlinkSync(s.policyFile); symlinkSync(outsidePolicy, s.policyFile);
    expect((await backup(s.ctx, { apply: false, now: NOW })).ok).toBe(false);
    expect(existsSync(s.root)).toBe(false);
  });

  it.each(["photo", "strategy"])("verification refuses a missing %s even when its manifest entry was also removed", async (kind) => {
    const s = await setup();
    expect((await backup(s.ctx, { apply: true, now: NOW })).ok).toBe(true);
    const key = kind === "photo" ? photoKey : strategyKey;
    unlinkSync(path.join(s.snapshot, key));
    const manifest = readManifest(s.snapshot);
    if (!manifest) throw new Error("manifest missing");
    manifest.files = manifest.files.filter((file) => file.path !== key);
    writeFileSync(path.join(s.snapshot, MANIFEST), JSON.stringify(manifest));
    expect(checkManifest(s.snapshot).problems).toEqual([]);
    const result = verify(s.ctx, s.snapshot);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("missing");
  });

  it("refuses changed inventory bytes before copying a newly selected authority file", async () => {
    const s = await setup();
    const files = watchBackupFiles(s.ctx.paths, s.ctx.paths.db);
    writeFileSync(s.policyFile, JSON.stringify({ ...s.policy, enabled: false }));
    const stage = path.join(s.ctx.paths.home, "test.partial");
    mkdirSync(stage);
    expect(() => copyWatchBackupFiles(stage, files)).toThrow(/changed since the backup inventory/);
    expect(existsSync(path.join(stage, policyKey))).toBe(false);
  });

  it.each(["size", "path"])("refuses a corrupted stored photo %s descriptor", async (kind) => {
    const s = await setup();
    const h = openDb(s.ctx.paths.db);
    try {
      const photo = kind === "size" ? { ...PHOTO, bytes: PHOTO.bytes + 1 } : { ...PHOTO, blobRef: "../secret.png" };
      h.db.$client.prepare("UPDATE watch_public_proposals SET photo = ?").run(JSON.stringify(photo));
    } finally { h.close(); }
    const result = await backup(s.ctx, { apply: true, now: NOW });
    expect(result.ok).toBe(false);
    expect(existsSync(s.snapshot)).toBe(false);
  });

  it.each(["projects", "state", "data"])("refuses a linked snapshot %s root before inventory or temporary DB copy", async (part) => {
    const s = await setup();
    expect((await backup(s.ctx, { apply: true, now: NOW })).ok).toBe(true);
    const manifest = readManifest(s.snapshot);
    if (!manifest) throw new Error("manifest missing");
    const linked = path.join(s.snapshot, part);
    rmSync(linked, { recursive: true });
    const outside = part === "projects" ? s.ctx.paths.projects : part === "state" ? s.ctx.paths.state : path.dirname(s.ctx.paths.db);
    symlinkSync(outside, linked);
    expect(checkWatchBackup(s.snapshot, manifest.files).join("; ")).toContain("symbolic links");
    const direct = restoreSnapshotDb(s.snapshot, manifest);
    expect(direct.problems.join("; ")).toContain("symbolic links");
    expect(direct.lines).toEqual([]);
    expect(verify(s.ctx, s.snapshot).ok).toBe(false);
  });

  it("allows the operator-selected snapshot root alias while containing every recovery child beneath its real root", async () => {
    const s = await setup();
    expect((await backup(s.ctx, { apply: true, now: NOW })).ok).toBe(true);
    const alias = path.join(s.ctx.paths.home, "selected-snapshot");
    symlinkSync(s.snapshot, alias);
    expect(verify(s.ctx, alias).ok).toBe(true);
  });

  it("reads an older schema without a photo column as empty and never migrates the source", () => {
    const f = fake();
    temporary.push(path.dirname(f.root));
    mkdirSync(path.dirname(f.ctx.paths.db), { recursive: true });
    const migrations = path.join(f.ctx.paths.home, "empty-migrations");
    mkdirSync(migrations);
    const h = openOwnFile(f.ctx.paths.db, { migrationsFolder: migrations, label: "legacy-test" });
    h.client.exec("CREATE TABLE watch_public_proposals (project TEXT NOT NULL, text TEXT NOT NULL)");
    h.close();
    const before = readFileSync(f.ctx.paths.db);
    expect(publicPhotoBackupReferences(f.ctx.paths.db)).toEqual([]);
    expect(readFileSync(f.ctx.paths.db)).toEqual(before);
  });
});
