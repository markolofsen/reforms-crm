import { describe, expect, it } from "vitest";
import { buildDirectory, type DirectoryEntry } from "@hub/messengers";
import type { ClientDirectory } from "./client-directory";
import { createMessengerIdentityResolver } from "./messenger-identity";

const entry: DirectoryEntry = { key: "notion-page-1", name: "Mark", email: "mark@example.com", relationship: "Client", identifiers: [] };
const directory = { current: () => buildDirectory([entry]) } satisfies Pick<ClientDirectory, "current">;

describe("MessengerIdentityResolver", () => {
  it("prefers the stored page reference over the directory index", () => {
    const resolver = createMessengerIdentityResolver({ project: "saas-support", directory });

    expect(resolver.resolve("saas-support", "mark@example.com", { notionPageId: "stored-page", notionUrl: null })).toEqual({
      state: "resolved",
      pageId: "stored-page",
      url: null,
    });
  });

  it("resolves a directory match and distinguishes loaded misses", () => {
    const resolver = createMessengerIdentityResolver({ project: "saas-support", directory });

    expect(resolver.resolve("saas-support", "mark@example.com", null)).toMatchObject({ state: "resolved", pageId: "notion-page-1" });
    expect(resolver.resolve("saas-support", "other@example.com", null)).toEqual({ state: "unresolved", pageId: null, url: null });
  });

  it("reports an unavailable directory outside the active project", () => {
    const resolver = createMessengerIdentityResolver({ project: null, directory });

    expect(resolver.resolve("realty-crm", "mark@example.com", null)).toEqual({ state: "unavailable", pageId: null, url: null });
  });

  it("maps the normalized identity into the client DTO", () => {
    const resolver = createMessengerIdentityResolver({ project: "saas-support", directory });

    expect(resolver.client("saas-support", { id: 1, name: "Mark", email: "mark@example.com" }, null)).toMatchObject({
      id: 1,
      notionPageId: "notion-page-1",
      notion: { state: "resolved" },
    });
  });
});
