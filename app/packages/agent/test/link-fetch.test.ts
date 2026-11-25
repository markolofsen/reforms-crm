import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { checkLinkUrl, isPublicAddress, LinkRefused, pageText, type LinkFetch } from "../src/link/fetch";
import { createHubMcpServer } from "../src/mcp/server";

// Owner 2026-11-25: the agent opens a link a client sent; an image comes back as image content. Only a public http(s) address.

describe("which links are opened", () => {
  it("public addresses pass; loopback, private, link-local, CGNAT, multicast and mapped private ones do not", () => {
    for (const ip of ["93.184.216.34", "2606:4700::6810:84e5", "8.8.8.8"]) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "nope"]) expect(isPublicAddress(ip), ip).toBe(false);
  });

  it("only http(s), no credentials, no local name or private literal", () => {
    expect(checkLinkUrl("https://media.carapis.com/a/b.jpg").hostname).toBe("media.carapis.com");
    for (const u of ["file:///etc/passwd", "ftp://x.example/a", "http://localhost:3000/", "http://app.localhost/", "http://printer.local/", "http://127.0.0.1:4318/api", "http://[::1]/", "http://169.254.169.254/latest", "https://user:pw@example.com/", "not a url"]) {
      expect(() => checkLinkUrl(u), u).toThrow(LinkRefused);
    }
  });

  it("a page's text drops scripts, styles and tags and keeps the title", () => {
    expect(pageText("<html><head><title> Bug &amp; fix </title><style>p{}</style></head><body><script>alert(1)</script><p>Line one</p><p>Two &lt;3</p></body></html>")).toEqual({ title: "Bug & fix", text: "Bug & fix\nLine one\nTwo <3" });
  });
});

describe("link_fetch", () => {
  let dir: string;
  let h: DbHandle;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "hub-link-"));
    h = openDb(path.join(dir, "app.db"));
  });
  afterEach(() => {
    h.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const call = async (linkFetch: LinkFetch, url: string) => {
    const server = createHubMcpServer(createRepos(h.db), { hubProject: "acme", focusFile: path.join(dir, "focus.json"), linkFetch });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    return client.callTool({ name: "link_fetch", arguments: { url } });
  };
  const PNG = Buffer.from("89504e470d0a1a0a", "hex");

  it("returns an image as image content, and the JSON without the bytes", async () => {
    const r = await call(async (url) => ({ url, status: 200, contentType: "image/png", body: PNG, cut: false }), "https://media.carapis.com/x.png");
    const content = r.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    expect(content.map((c) => c.type)).toEqual(["text", "image"]);
    expect(content[1]).toMatchObject({ data: PNG.toString("base64"), mimeType: "image/png" });
    expect(JSON.parse(content[0]!.text!)).toMatchObject({ kind: "image", bytes: PNG.length, url: "https://media.carapis.com/x.png" });
    expect(content[0]!.text).not.toContain(PNG.toString("base64"));
  });

  it("returns a page's text; refuses a private link and answers a failure in one code", async () => {
    const page = await call(async (url) => ({ url, status: 200, contentType: "text/html", body: Buffer.from("<title>T</title><p>Hello</p>"), cut: false }), "https://example.com/");
    expect(JSON.parse((page.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ kind: "text", title: "T", text: "T\nHello" });
    const refused = await call(async () => { throw new LinkRefused("127.0.0.1 is not a public address"); }, "http://127.0.0.1/");
    expect(JSON.parse((refused.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ error: "link_refused" });
    const gone = await call(async (url) => ({ url, status: 404, contentType: "text/html", body: Buffer.from(""), cut: false }), "https://example.com/missing");
    expect(JSON.parse((gone.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ error: "link_failed" });
    const pdf = await call(async (url) => ({ url, status: 200, contentType: "application/pdf", body: Buffer.from("%PDF"), cut: false }), "https://example.com/a.pdf");
    expect(JSON.parse((pdf.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ error: "link_failed" });
  });
});
