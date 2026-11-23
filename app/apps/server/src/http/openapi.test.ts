import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Repos } from "@hub/db";
import { OPERATIONS } from "../composition/operations";
import { testApp } from "../test-support/runtime";
import { emittedDocument } from "./emitted";

const api = (f: string) => fileURLToPath(new URL(`../../../../packages/api/${f}`, import.meta.url));

// P120 W1: the server's declared operations are the OpenAPI document; nothing is kept by hand for a declared domain.
describe("the server emits its OpenAPI document", () => {
  it("every declared operation is a route of the app", () => {
    const routes = new Set(testApp({} as Repos).routes.map((r) => `${r.method.toLowerCase()} ${r.path}`));
    for (const op of OPERATIONS) expect(routes.has(`${op.method} ${op.path}`), `${op.method} ${op.path}`).toBe(true);
  });
  it("openapi.json is fresh: the emitted document over the base, byte for byte", () => {
    const base = JSON.parse(readFileSync(api("openapi.base.json"), "utf8"));
    expect(readFileSync(api("openapi.json"), "utf8")).toBe(`${JSON.stringify(emittedDocument(base), null, 2)}\n`);
  });
  it("the base keeps no path a domain declares", () => {
    const base = JSON.parse(readFileSync(api("openapi.base.json"), "utf8")) as { paths: Record<string, unknown> };
    for (const op of OPERATIONS) expect(base.paths[op.path.replace(/:(\w+)/g, "{$1}")]).toBeUndefined();
  });
});
