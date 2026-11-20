import { describe, expect, it } from "vitest";
import { DROP_LIMITS } from "@hub/contract/terminal";
import { dropTooBig } from "../src/features/terminal/session";

// P76: the pane refuses a drop past the caps itself, naming the file and the limit (Next's buffer sits in front of the server).

const MB = 1024 * 1024;

describe("dropTooBig", () => {
  it("within the caps: null", () => {
    expect(dropTooBig([{ name: "a.png", size: 5 * MB }, { name: "b.png", size: 5 * MB }])).toBeNull();
  });
  it("one file past the limit is named", () => {
    expect(dropTooBig([{ name: "x.mov", size: 30 * MB }])).toBe("x.mov is 30 MB; a drop takes 20 MiB in all. Nothing was pasted.");
  });
  it("files past the limit together", () => {
    expect(dropTooBig([{ name: "a", size: 12 * MB }, { name: "b", size: 12 * MB }])).toBe("These 2 files are 24 MB together; a drop takes 20 MiB in all. Nothing was pasted.");
  });
  it("more files than the cap", () => {
    const many = Array.from({ length: DROP_LIMITS.files + 1 }, (_, i) => ({ name: `f${i}`, size: 1 }));
    expect(dropTooBig(many)).toBe(`A drop takes at most ${DROP_LIMITS.files} files; this one has ${DROP_LIMITS.files + 1}. Nothing was pasted.`);
  });
});
