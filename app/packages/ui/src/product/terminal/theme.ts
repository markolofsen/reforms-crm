import type { ITheme } from "@xterm/xterm";

// The terminal's colours are tokens of `styles.css` (`--terminal-*`, a light and a dark set side by side), read from the
// computed style of the terminal's own element (design-system-and-tokens 9): never cached, so a theme change is read again.

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
const bright = (c: string) => `bright${c.charAt(0).toUpperCase()}${c.slice(1)}`;

/** xterm's theme key to the token that holds it. */
export const TERMINAL_TOKENS: Readonly<Record<string, string>> = {
  background: "--terminal-bg",
  foreground: "--terminal-fg",
  cursor: "--terminal-cursor",
  cursorAccent: "--terminal-bg",
  selectionBackground: "--terminal-selection",
  ...Object.fromEntries(ANSI.flatMap((c) => [[c, `--terminal-${c}`], [bright(c), `--terminal-bright-${c}`]])),
};

/** The theme as the tokens say now. A token that is missing is left to xterm's default. */
export function readTheme(el: Element): ITheme {
  const style = getComputedStyle(el);
  const theme: Record<string, string> = {};
  for (const [key, token] of Object.entries(TERMINAL_TOKENS)) {
    const value = style.getPropertyValue(token).trim();
    if (value) theme[key] = value;
  }
  return theme;
}
