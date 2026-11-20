// Which keys the terminal keeps from the program it runs. Pure, so `packages/ui/test/terminal-keys.test.ts` holds it.

/** What Claude Code reads as "new line, do not submit" (ESC CR, the sequence its `/terminal-setup` binds), until xterm 6.1 brings the Kitty protocol. */
export const SHIFT_ENTER = "\x1b\r";

type Key = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Ctrl+` alone: the app's terminal toggle (the VS Code and Cursor chord). */
export const isToggleChord = (e: Key): boolean => e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.code === "Backquote" || e.key === "`");

/**
 * Where a key goes: `app` lets it bubble to the page untouched (the toggle chord, so it works while the terminal has focus),
 * `newline` sends {@link SHIFT_ENTER}, `program` is xterm's as usual. Escape, `?`, `[` and every other key are the program's.
 */
export function keyRoute(e: Key): "app" | "newline" | "program" {
  if (isToggleChord(e)) return "app";
  if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) return "newline";
  return "program";
}

/**
 * How long a lone Enter waits after a chunk of text (P88, research 27 B7). A CLI such as Claude Code reads several characters
 * that arrive at once (a paste, dictation, a typing tool) as a paste, and an Enter inside its paste window as a new line, not a
 * submit: the owner's first Return after a long phrase made a new line. The terminal holds that Enter until the chunk is this old.
 */
export const ENTER_SETTLE_MS = 250;

/**
 * The input path of the terminal: `send` gets every chunk in order; a lone CR that follows a chunk of two or more characters
 * (not an escape sequence) by less than {@link ENTER_SETTLE_MS} is held until that time has passed, and whatever arrives while
 * it is held queues behind it. Typed keys, one at a time, are never held. `now` and `later` are injectable for the unit test.
 */
export function enterPacer(send: (d: string) => void, now: () => number = () => performance.now(), later: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms)): (d: string) => void {
  let chunkAt = Number.NEGATIVE_INFINITY;
  let held: string[] | null = null;
  return (d) => {
    if (held) return void held.push(d);
    const since = now() - chunkAt;
    if (d === "\r" && since < ENTER_SETTLE_MS) {
      held = [d];
      later(() => {
        const queue = held ?? [];
        held = null;
        for (const x of queue) send(x);
      }, ENTER_SETTLE_MS - since);
      return;
    }
    if (d.length > 1 && !d.startsWith("\x1b")) chunkAt = now();
    send(d);
  };
}
