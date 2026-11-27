import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PublicPhotoAsset } from "@hub/contract/watch-media";
import { openDb, type DbHandle } from "../src/client";
import { createRepos, type Repos } from "../src/repos";
import { liveSeq, liveSince } from "../src/live";
import type { NewPublicReplyProposal, PublicReplyProposalRow } from "../src/repos/sends";

const START = Date.parse("2026-11-27T10:00:00.000Z");
const at = (seconds = 0) => new Date(START + seconds * 1_000).toISOString();
const photo: PublicPhotoAsset = { kind: "photo", blobRef: `${"a".repeat(64)}.png`, sha256: "a".repeat(64), mime: "image/png", bytes: 73, width: 1, height: 1 };
let handle: DbHandle;
let repos: Repos;
const proposal = (id: string, patch: Partial<NewPublicReplyProposal> = {}): NewPublicReplyProposal => ({
  id, project: "acme", direction: "support", account: "123456", groupUsername: "acme_chat",
  chatId: -1001234567890, accessHash: "1234", replyToMessageId: 42, threadId: 20, targetKey: "same-physical-account-and-peer-and-message",
  text: "A reviewed reply", textHash: "b".repeat(64), sourceHash: "c".repeat(64), sourceAt: at(-120),
  rulesHash: "d".repeat(64), policyGeneration: "generation", policyRevision: 2, strategyHash: "e".repeat(64),
  reviewRef: "external-review", reviewedAt: at(), createdAt: at(), expiresAt: at(1_800), randomId: "123456789",
  ...patch,
});
const identity = (p: PublicReplyProposalRow) => ({ proposalId: p.id, project: p.project, account: p.account, assetHash: photo.sha256,
  photoId: "9001", accessHash: "2345", fileReference: "AQID", createdAt: at() });
const begin = (p: PublicReplyProposalRow, payloadHash = p.payloadHash ?? p.textHash) => repos.sends.beginPublicReply({
  project: p.project, proposalId: p.id, textHash: p.textHash, payloadHash, policyGeneration: p.policyGeneration,
  at: at(10), limits: { dailyCap: 30, spacingSeconds: 0, actorCap: 3 },
});
beforeEach(() => { handle = openDb(":memory:"); repos = createRepos(handle.db); });
afterEach(() => handle.close());

describe("public proposal source scope and prepared identity", () => {
  it("applies project, direction, username, account and physical source scope before its bounded newest-first limit", async () => {
    const older = await repos.sends.createPublicProposal(proposal("selected-old"));
    const newest = await repos.sends.createPublicProposal(proposal("selected-new", { createdAt: at(1) }));
    for (let i = 0; i < 25; i++) {
      await repos.sends.createPublicProposal(proposal(`other-direction-${i}`, { direction: "other", createdAt: at(30 + i) }));
      await repos.sends.createPublicProposal(proposal(`other-username-${i}`, { groupUsername: "renamed_chat", createdAt: at(30 + i) }));
    }
    for (const [i, scope] of [{ project: "other" }, { account: "654321" }, { chatId: -1009876543210 }, { replyToMessageId: 43 }].entries()) {
      await repos.sends.createPublicProposal(proposal(`other-scope-${i}`, { ...scope, createdAt: at(100) }));
    }
    const query = { project: "acme", direction: "support", groupUsername: "acme_chat", account: "123456", chatId: -1001234567890, messageId: 42 };
    expect((await repos.sends.publicProposalsForSource({ ...query, limit: 20 })).map((p) => p.id)).toEqual([newest.id, older.id]);
    expect((await repos.sends.publicProposalsForSource({ ...query, limit: 1 })).map((p) => p.id)).toEqual([newest.id]);
    expect(await repos.sends.publicProposalsForSource({ ...query, project: "missing" })).toEqual([]);
    expect(await repos.sends.publicProposal("other", older.id)).toBeNull();
  });

  it("legacy nullable payload hashes stay usable for text without any prepared media row", async () => {
    const p = await repos.sends.createPublicProposal(proposal("legacy"));
    expect(p).toMatchObject({ photo: null, payloadHash: null });
    expect(await begin(p)).toMatchObject({ status: "sending", publicProposalId: p.id, messengerDraftId: null, actor: "watch_review" });
    expect(await repos.sends.publicPhoto("acme", p.id)).toBeNull();
  });

  it("requires the full payload and a durable matching identity before audit; first preparation is immutable", async () => {
    const p = await repos.sends.createPublicProposal(proposal("photo", { photo, payloadHash: "f".repeat(64) }));
    await expect(begin(p, p.textHash)).rejects.toMatchObject({ code: "wrong_state" });
    await expect(begin(p)).rejects.toThrow(/persisted provider identity/);
    await expect(repos.sends.preparePublicPhoto({ ...identity(p), assetHash: "0".repeat(64) })).rejects.toMatchObject({ code: "wrong_state" });
    await expect(repos.sends.preparePublicPhoto({ ...identity(p), account: "654321" })).rejects.toMatchObject({ code: "wrong_state" });
    await expect(repos.sends.preparePublicPhoto({ ...identity(p), project: "other" })).rejects.toMatchObject({ code: "wrong_state" });
    const before = liveSeq(handle.db);
    const first = await repos.sends.preparePublicPhoto(identity(p));
    expect(liveSince(handle.db, before).changes.map((c) => [c.tbl, c.project])).toEqual([["watch_public_photos", "acme"]]);
    expect(await repos.sends.preparePublicPhoto({ ...identity(p), photoId: "9999", fileReference: "BAUG" })).toEqual(first);
    expect(await repos.sends.publicPhoto("other", p.id)).toBeNull();
    expect(await begin(p)).toMatchObject({ status: "sending", publicProposalId: p.id });
    await expect(repos.sends.preparePublicPhoto(identity(p))).rejects.toThrow(/already has an attempt/);
    expect(await repos.sends.publicPhoto("acme", p.id)).toEqual(first);
  });

  it("keeps an unresolved photo's physical target and account quota reserved across projects and directions", async () => {
    const p = await repos.sends.createPublicProposal(proposal("photo", { photo, payloadHash: "f".repeat(64) }));
    await repos.sends.preparePublicPhoto(identity(p));
    const audit = await begin(p);
    await repos.sends.markPublicUncertain(audit.id, "timeout after sendMedia", "500");
    repos = createRepos(handle.db);
    expect(await repos.sends.publicTargetReserved(p.targetKey)).toBe(true);
    expect(await repos.sends.publicReplyUsage(p.account, at(20))).toBe(1);
    const other = await repos.sends.createPublicProposal(proposal("another", { project: "other", direction: "another" }));
    await expect(begin(other)).rejects.toMatchObject({ code: "wrong_state" });
    expect(await repos.sends.publicAttempt(other.id)).toBeNull();
    expect(await repos.sends.publicAttempt(p.id)).toMatchObject({ status: "sending", sentMessageId: "500" });
  });

  it("private preparation emits insert, update and delete invalidations without exposing provider fields", async () => {
    const p = await repos.sends.createPublicProposal(proposal("photo", { photo, payloadHash: "f".repeat(64) }));
    await repos.sends.preparePublicPhoto(identity(p));
    let since = liveSeq(handle.db);
    handle.db.$client.prepare("UPDATE watch_public_photos SET file_reference = ? WHERE proposal_id = ?").run("BAUG", p.id);
    expect(liveSince(handle.db, since).changes.map((c) => c.tbl)).toEqual(["watch_public_photos"]);
    since = liveSeq(handle.db);
    handle.db.$client.prepare("DELETE FROM watch_public_photos WHERE proposal_id = ?").run(p.id);
    expect(liveSince(handle.db, since).changes).toEqual([{ tbl: "watch_public_photos", project: "acme", seq: since + 1 }]);
  });
});
