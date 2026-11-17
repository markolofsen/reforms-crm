import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ShellError from "../src/app/(shell)/error";

describe("(shell)/error.tsx", () => {
  it("names the cause and offers Retry, without taking the whole viewport (the sidebar stays)", () => {
    const html = renderToStaticMarkup(<ShellError error={new Error("The card broke.")} reset={() => {}} />);
    expect(html).toContain("The card broke.");
    expect(html).toContain("Retry");
    expect(html).not.toContain("min-h-svh");
  });
});
