import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// P127 D1 (V11, P43's idea): every view `@hub/ui/product/…` exports is drawn by a story in apps/storybook, so a shared view never
// lands unseen. A `.ts` target is data or a hook, not a view (`terminal/speech-language`), and needs none.
const root = join(import.meta.dirname, "..");
const storiesDir = join(root, "../../apps/storybook/src/stories");
const { exports } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { exports: Record<string, string> };
const views = Object.entries(exports)
  .filter(([key, target]) => key.startsWith("./product/") && target.endsWith(".tsx"))
  .map(([key]) => `@hub/ui${key.slice(1)}`);
const stories = readdirSync(storiesDir)
  .filter((f) => f.endsWith(".stories.tsx"))
  .map((f) => readFileSync(join(storiesDir, f), "utf8"))
  .join("\n");

describe("every shared view has a story", () => {
  it("finds the views", () => {
    expect(views.length).toBeGreaterThan(20);
  });
  it.each(views)("%s is imported by a story", (view) => {
    expect(stories.includes(`"${view}"`), `${view}: add a story in apps/storybook/src/stories`).toBe(true);
  });
});
