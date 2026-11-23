import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DesktopHandoffButton, LocalActionButton, runLocalAction } from "../src/components/local-action";
import { ApiFailure } from "../src/lib/api/client";
import { keys } from "../src/lib/cache/keys";

// P61: the admin's one Open component. An href action is a real anchor with the registry's link; a server action posts once
// and says a refusal in words; with `localOpen: false` a server action renders nothing.

const withInstance = (localOpen: boolean, node: ReactNode) => {
  const qc = new QueryClient();
  qc.setQueryData(keys.instance(), { name: "Hub", hasLogo: false, localOpen });
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};

describe("runLocalAction", () => {
  it("hands an href action's registry link to the system, and posts nothing", async () => {
    const io = { post: vi.fn(), open: vi.fn(), say: vi.fn() };
    expect(await runLocalAction("mail.compose", { to: "a@x.com", cc: null, subject: "Hi" }, io)).toBe(true);
    expect(io.open).toHaveBeenCalledWith("mailto:a%40x.com?subject=Hi");
    expect(io.post).not.toHaveBeenCalled();
    expect(await runLocalAction("mail.openMessage", { messageId: "draft-12" }, io)).toBe(false);
    expect(io.say).toHaveBeenCalledWith("No link can be built for this.");
  });
  it("posts a server action once with its key, and says a refusal in words", async () => {
    const post = vi.fn().mockRejectedValueOnce(new ApiFailure("Not opened: that entry is not in the project's knowledge index.", "not_found", 404));
    const io = { post, open: vi.fn(), say: vi.fn() };
    expect(await runLocalAction("file.open", { project: "acme", key: "knowledge:knowledge/files/x.md" }, io)).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("file.open", { project: "acme", key: "knowledge:knowledge/files/x.md" });
    expect(io.say).toHaveBeenCalledWith("Not opened: that entry is not in the project's knowledge index.");
    expect(io.open).not.toHaveBeenCalled();
  });
});

describe("LocalActionButton", () => {
  it("an href action renders an anchor with the registry's href", () => {
    const html = renderToStaticMarkup(<LocalActionButton action="mail.openMessage" args={{ messageId: "<abc@host.example>" }} />);
    expect(html).toContain('href="message://%3Cabc%40host.example%3E"');
    expect(html).toContain("Open their message"); // P105 S2's label
    expect(renderToStaticMarkup(<LocalActionButton action="mail.openMessage" args={{ messageId: "draft-12" }} />)).toBe("");
  });
  it("a server action is a button, and nothing when this machine cannot open", () => {
    const on = withInstance(true, <LocalActionButton action="finder.open" args={{ project: "acme", key: "knowledge" }} />);
    expect(on).toContain("<button");
    expect(on).toContain("Open folder");
    expect(on).not.toContain("href=");
    expect(withInstance(false, <LocalActionButton action="finder.open" args={{ project: "acme", key: "knowledge" }} />)).toBe("");
  });
  it("the desktop handoff is disabled with its reason for an agent tab, absent for Shell", () => {
    const claude = withInstance(true, <DesktopHandoffButton preset="claude" />);
    expect(claude).toContain("disabled");
    expect(claude).toContain("Not offered: Claude Desktop would run this session without the hub&#x27;s rules");
    expect(withInstance(true, <DesktopHandoffButton preset="codex" />)).toContain("Codex: the ChatGPT app");
    expect(withInstance(true, <DesktopHandoffButton preset="shell" />)).toBe("");
    expect(withInstance(false, <DesktopHandoffButton preset="claude" />)).toBe("");
  });
});
