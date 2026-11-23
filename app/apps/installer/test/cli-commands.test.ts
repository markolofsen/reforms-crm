import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
const GROUPS = ["session", "server", "instance", "drafts", "connections", "logs"];

// P126 C1: `cli.ts` keeps the program, the help and the sync hook; each command lives in `commands/<group>.ts`.
describe("the hub CLI is one program over command modules", () => {
  it("cli.ts is the program only", () => {
    const cli = read("cli.ts");
    expect(cli.split("\n").length).toBeLessThanOrEqual(120);
    expect(cli).not.toMatch(/\.command\(/);
  });
  it.each(GROUPS)("commands/%s.ts exports register and cli.ts calls it", (g) => {
    expect(read(`commands/${g}.ts`)).toMatch(/export function register\(program: Command\): void/);
    expect(read("cli.ts")).toContain(`from "./commands/${g}"`);
  });
});
