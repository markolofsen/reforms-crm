import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Link } from "@hub/ui/link";

describe("Link", () => {
  it("tells a screen reader that a link opens a new tab, and says nothing for an ordinary one", () => {
    const external = renderToStaticMarkup(<Link href="https://example.test" target="_blank">Notion</Link>);
    expect(external).toContain("Notion");
    expect(external).toContain("(opens in a new tab)");
    expect(external).toContain('rel="noreferrer"');
    expect(renderToStaticMarkup(<Link href="/x">Plain</Link>)).not.toContain("new tab");
  });
});
