import { describe, expect, it } from "vitest";
import { classifyDrop, cleanText, DROP_TEXT_MAX, dragKind, pasteLine, shellPath, type DropSource } from "../src/product/terminal/drop";

// P76, decision 0041: what a drop on the terminal is, and the text pasted for it. A structural DataTransfer: no DOM here.

type F = { name: string };
const source = (o: { types: string[]; files?: F[]; dirs?: boolean[]; data?: Record<string, string> }): DropSource<F> => ({
  types: o.types,
  files: o.files ?? [],
  items: (o.dirs ?? []).map((isDirectory) => ({ kind: "file", webkitGetAsEntry: () => ({ isDirectory }) })),
  getData: (t) => o.data?.[t] ?? "",
});

describe("dragKind: what a drag carries before the drop", () => {
  it("files first (a Finder drag is types [Files] only), then text, else nothing", () => {
    expect(dragKind(["Files"])).toBe("files");
    expect(dragKind(["text/plain", "Files"])).toBe("files");
    expect(dragKind(["text/uri-list"])).toBe("text");
    expect(dragKind(["text/plain"])).toBe("text");
    expect(dragKind(["text/html"])).toBeNull();
  });
});

describe("classifyDrop", () => {
  it("files, in the order dropped", () => {
    const files = [{ name: "a.png" }, { name: "b.md" }];
    expect(classifyDrop(source({ types: ["Files"], files, dirs: [false, false] }))).toEqual({ kind: "files", files });
  });
  it("a folder among the files refuses them all", () => {
    expect(classifyDrop(source({ types: ["Files"], files: [{ name: "a.png" }, { name: "dir" }], dirs: [false, true] }))).toEqual({ kind: "folder" });
  });
  it("without webkitGetAsEntry the files are taken", () => {
    const d = { types: ["Files"], files: [{ name: "a" }], items: [{ kind: "file" }], getData: () => "" };
    expect(classifyDrop(d).kind).toBe("files");
  });
  it("a uri-list before text/plain, comments dropped, URLs one space apart", () => {
    const d = source({ types: ["text/uri-list", "text/plain"], data: { "text/uri-list": "# from a page\r\nhttps://a.example/x\r\nhttps://b.example/\r\n", "text/plain": "ignored" } });
    expect(classifyDrop(d)).toEqual({ kind: "text", text: "https://a.example/x https://b.example/" });
  });
  it("plain text, controls stripped", () => {
    expect(classifyDrop(source({ types: ["text/plain"], data: { "text/plain": "hi\u001b[201~ there\r\nnext\u0007" } }))).toEqual({ kind: "text", text: "hi[201~ there\nnext" });
  });
  it("nothing usable is none", () => {
    expect(classifyDrop(source({ types: ["Files"] })).kind).toBe("none");
    expect(classifyDrop(source({ types: ["text/plain"], data: { "text/plain": "\u0000\u0001" } })).kind).toBe("none");
  });
});

describe("cleanText", () => {
  it("keeps tab, newline and every printable character, Cyrillic and emoji included; drops C0, DEL and C1", () => {
    expect(cleanText("a\tb\nв 🙂")).toBe("a\tb\nв 🙂");
    expect(cleanText("\u0000a\u0008\u000bb\u001b\u007fc\u009bd")).toBe("abcd");
  });
  it("is cut to the cap", () => {
    expect(cleanText("x".repeat(DROP_TEXT_MAX + 5))).toHaveLength(DROP_TEXT_MAX);
  });
});

describe("the pasted line", () => {
  it("a safe path is bare; one space between and one after", () => {
    expect(pasteLine(["/Users/m/hub/state/drops/saas/abc/Скриншот-1.png", "/u/b.md"])).toBe("/Users/m/hub/state/drops/saas/abc/Скриншот-1.png /u/b.md ");
  });
  it("a home with a space or a special is backslash-escaped, as Terminal.app types it", () => {
    expect(shellPath("/Users/m/My Hub/state/drops/x/a.png")).toBe("/Users/m/My\\ Hub/state/drops/x/a.png");
    expect(shellPath("/u/it's(1)")).toBe("/u/it\\'s\\(1\\)");
  });
});
