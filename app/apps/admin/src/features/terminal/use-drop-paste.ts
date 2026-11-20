"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { DROP_LIMITS } from "@hub/contract/terminal";
import { pasteLine, type Dropped, type TerminalHandle } from "@hub/ui/product/terminal";
import { terminalApi } from "@/lib/api/terminal";
import { sentence } from "@/lib/api/client";

/** How long the outcome stays in the pane's status line. */
const NOTE_MS = 8_000;
const MB = 1024 * 1024;
const LIMIT_MIB = DROP_LIMITS.bytes / MB;
const size = (bytes: number) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
export const FOLDER_REFUSED = "Folders are not taken: drop the files, or a zip of the folder.";

/** Why these files cannot go in one drop, said by the pane itself (a refusal past Next's buffer would not reach it as a sentence); null when they can. */
export function dropTooBig(files: ReadonlyArray<{ name: string; size: number }>): string | null {
  if (files.length > DROP_LIMITS.files) return `A drop takes at most ${DROP_LIMITS.files} files; this one has ${files.length}. Nothing was pasted.`;
  const big = files.find((f) => f.size > DROP_LIMITS.bytes);
  if (big) return `${big.name} is ${size(big.size)}; a drop takes ${LIMIT_MIB} MiB in all. Nothing was pasted.`;
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > DROP_LIMITS.bytes) return `These ${files.length} files are ${size(total)} together; a drop takes ${LIMIT_MIB} MiB in all. Nothing was pasted.`;
  return null;
}

/**
 * P76, decision 0041: a drop on the session's terminal. Files are copied by the server under `state/drops/` and their paths
 * pasted (xterm's paste, through the session's own socket); text is pasted as is; a folder is refused. Nothing is sent: the
 * owner presses Enter. `note` is the outcome for the pane's status line.
 */
export function useDropPaste(session: string, screen: RefObject<TerminalHandle | null>) {
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const say = (text: string | null, keep = false) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNote(text);
    if (text && !keep) timer.current = setTimeout(() => setNote(null), NOTE_MS);
  };
  const paste = (text: string) => {
    screen.current?.paste(text);
    screen.current?.focus();
  };
  const onDrop = (d: Dropped) => {
    if (d.kind === "none") return;
    if (d.kind === "folder") return say(FOLDER_REFUSED);
    if (d.kind === "text") return paste(d.text);
    const refused = dropTooBig(d.files);
    if (refused) return say(refused);
    const count = `${d.files.length} file${d.files.length === 1 ? "" : "s"}`;
    say(`Copying ${count}…`, true);
    terminalApi.drop(session, d.files).then(
      (r) => {
        paste(pasteLine(r.paths));
        say(`${count} pasted.`);
      },
      (e: unknown) => say(`${sentence(e)} Nothing was pasted.`),
    );
  };
  return { note, onDrop };
}
