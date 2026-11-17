import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadToken, NoTokenError } from "../src/token";

describe("loadToken", () => {
  it("prefers NOTION_TOKEN", async () => {
    expect(await loadToken({ NOTION_TOKEN: " ntn\u005fenv \n" }, "/nonexistent")).toBe("ntn\u005fenv");
  });

  it("falls back to the token file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tok-"));
    const file = join(dir, "notion-token");
    await writeFile(file, "ntn\u005ffile\n");
    expect(await loadToken({}, file)).toBe("ntn\u005ffile");
  });

  it("explains how to supply one and never echoes a value", async () => {
    const err = await loadToken({}, "/nonexistent").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoTokenError);
    expect((err as Error).message).toMatch(/NOTION_TOKEN/);
    expect((err as Error).message).toMatch(/chmod 600/);
  });
});
