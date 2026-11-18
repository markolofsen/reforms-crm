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
