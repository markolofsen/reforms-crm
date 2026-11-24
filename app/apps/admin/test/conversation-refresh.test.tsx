import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationHeaderActions } from "../src/components/conversation/header-actions";
import { RefreshConversation, REFRESHED_MS, refreshLabel } from "../src/features/mail/conversation/refresh";

// P140 R5: Refresh in the conversation header, the stock ActionButton (quiet, size s), first in the header's tools.

describe("Refresh in the conversation header", () => {
  it("reads Refresh, Refreshing… while it runs, Refreshed for 2 s, then Refresh again; Try again after a refusal", () => {
    expect(refreshLabel({ pending: false, failed: false, done: false })).toBe("Refresh");
    expect(refreshLabel({ pending: true, failed: false, done: false })).toBe("Refreshing…");
    expect(refreshLabel({ pending: false, failed: false, done: true })).toBe("Refreshed");
    expect(refreshLabel({ pending: false, failed: false, done: false })).toBe("Refresh");
    expect(refreshLabel({ pending: false, failed: true, done: false })).toBe("Try again");
    expect(REFRESHED_MS).toBe(2000);
  });

  it("renders as a quiet ActionButton before the Notion link", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ConversationHeaderActions notionPageId="0123456789abcdef0123456789abcdef" refresh={<RefreshConversation clientId={1} project="acme" />} />
      </QueryClientProvider>,
    );
    expect(html).toContain('data-testid="conversation-refresh"');
    expect(html).toContain('data-variant="quiet"');
    expect(html).toContain(">Refresh<");
    expect(html.indexOf("conversation-refresh")).toBeLessThan(html.indexOf("Notion"));
  });
});
