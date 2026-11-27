import { afterEach, describe, expect, it, vi } from "vitest";
import { getCreateManualMailDraftUrl, getGetConversationMailUrl, getGetConversationTextUrl, getGetDraftMailUrl, getSetClientMarksUrl, getStopEnrollmentUrl } from "../src/generated/mail/mail";
import { getCreateMessengerDraftUrl, getEditMessengerDraftUrl, getPrepareMessengerReplyUrl, getRestoreMessengerDraftUrl, getSetMessengerChatRulesUrl, getSkipMessengerDraftUrl } from "../src/generated/messengers/messengers";
import { getGetAgentSettingsUrl, getGetCoreUpdateUrl, getGetInstanceUrl, getGetOpsErrorsUrl, getGetSafetyRulesUrl, getGetSchemeUrl, getListProjectsUrl } from "../src/generated/meta/meta";
import { HubApiError, hubMutator, parseHubResponse } from "../src/runtime/mutator";

describe("generated Mail draft operation", () => {
  it("keeps the manual draft route exact and encodes path parameters", () => {
    const url = getCreateManualMailDraftUrl("saas/support", 1);

    expect(url).toBe("/api/projects/saas%2Fsupport/clients/1/draft");
    expect(url).not.toContain("conversation/draft");
  });
});

describe("generated Messenger draft operation", () => {
  it("keeps the manual unsent-draft route exact and encodes path parameters", () => {
    const url = getCreateMessengerDraftUrl("saas/support", 3);

    expect(url).toBe("/api/projects/saas%2Fsupport/messengers/chats/3/draft");
  });

  it("keeps the unsent draft action routes exact", () => {
    expect(getEditMessengerDraftUrl("saas/support", 7)).toBe("/api/projects/saas%2Fsupport/messengers/drafts/7/text");
    expect(getSkipMessengerDraftUrl("saas/support", 7)).toBe("/api/projects/saas%2Fsupport/messengers/drafts/7/skip");
    expect(getRestoreMessengerDraftUrl("saas/support", 7)).toBe("/api/projects/saas%2Fsupport/messengers/drafts/7/restore");
    expect(getPrepareMessengerReplyUrl("saas/support", 3)).toBe("/api/projects/saas%2Fsupport/messengers/chats/3/prepare");
    expect(getSetMessengerChatRulesUrl("saas/support", 3)).toBe("/api/projects/saas%2Fsupport/messengers/chats/3/rules");
  });
});

describe("generated read operations", () => {
  it("keeps Mail history and body routes exact", () => {
    expect(getGetConversationMailUrl("saas/support", 1)).toBe("/api/projects/saas%2Fsupport/clients/1/conversation/mail");
    expect(getGetConversationTextUrl("saas/support", 1, { m: "<message/id>" })).toBe("/api/projects/saas%2Fsupport/clients/1/conversation/text?m=%3Cmessage%2Fid%3E");
    expect(getGetDraftMailUrl("saas/support", 7)).toBe("/api/projects/saas%2Fsupport/drafts/7/mail");
  });

  it("keeps metadata routes stable", () => {
    expect(getGetInstanceUrl()).toBe("/api/instance");
    expect(getGetCoreUpdateUrl()).toBe("/api/instance/core");
    expect(getListProjectsUrl()).toBe("/api/projects");
    expect(getGetAgentSettingsUrl({ project: "saas/support" })).toBe("/api/agent-settings?project=saas%2Fsupport");
    expect(getGetSafetyRulesUrl({ project: "saas/support" })).toBe("/api/safety-rules?project=saas%2Fsupport");
    expect(getGetSchemeUrl()).toBe("/api/scheme");
    expect(getGetOpsErrorsUrl()).toBe("/api/ops/errors");
    expect(getStopEnrollmentUrl("saas/support", 7)).toBe("/api/projects/saas%2Fsupport/enrollments/7/stop");
  });
});

describe("generated Mail write operations", () => {
  it("keeps project scope in the body while preserving the legacy marks route", () => {
    expect(getSetClientMarksUrl(7)).toBe("/api/clients/7/marks");
  });
});

describe("generated runtime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries one busy response before returning the generated payload", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy", code: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = hubMutator<{ data: { ok: boolean }; status: number; headers: Headers }>("/api/projects", { method: "GET" });
    await vi.advanceTimersByTimeAsync(400);

    await expect(request).resolves.toMatchObject({ data: { ok: true }, status: 200 });
    await expect(request).resolves.toHaveProperty("headers");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("never replays a %s action after an ambiguous busy response", async (method) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "busy", code: "busy" }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = hubMutator("/api/projects/acme/watch/proposals/reviewed/send", { method, body: JSON.stringify({ ticket: "one-use" }) });
    const rejected = expect(request).rejects.toMatchObject({ name: "HubApiError", code: "busy", status: 503 });
    await vi.advanceTimersByTimeAsync(400);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows one busy retry for HEAD without adding a write action", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = hubMutator("/api/projects", { method: "HEAD" });
    await vi.advanceTimersByTimeAsync(400);
    await expect(request).resolves.toMatchObject({ data: null, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "HEAD", credentials: "same-origin" });
  });

  it("rejects a successful response with an unknown shape", () => {
    expect(() => parseHubResponse({ data: { ok: false }, status: 200 }, { safeParse: () => ({ success: false }) })).toThrow(HubApiError);
  });
});
