"use client";

import type { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { cn } from "../../cn";
import { keyRoute, SHIFT_ENTER } from "./keys";
import { readTheme } from "./theme";

export type TerminalSize = { cols: number; rows: number };
/** What the owner of the bytes (the socket) may do to the screen. */
export type TerminalHandle = { write: (bytes: Uint8Array) => void; reset: () => void; focus: () => void };

type Callbacks = {
  /** The terminal exists and is open: from here on the caller may write into it. */
  onReady: (handle: TerminalHandle) => void;
  /** Keystrokes, pastes and mouse reports, as bytes for the program. */
  onInput: (bytes: Uint8Array) => void;
  /** The grid changed size (reported once per distinct size). */
  onSize: (size: TerminalSize) => void;
  /** A link was activated (a plain URL or an OSC 8 hyperlink); the caller opens it, never the terminal. */
  onLink: (uri: string) => void;
};
type Props = Callbacks & {
  /** The resolved theme (`light` or `dark`); a change re-reads the colour tokens. */
  resolvedTheme: string | undefined;
  /** The accessible name of the input xterm types into. */
  inputLabel?: string;
  className?: string;
};

// The system monospace stack (no web font, so `document.fonts.ready` is the only gate), 13px, line height 1.2.
const FONT = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';
/** Frames to wait for a box that can be measured (hidden, or the font not measured yet) before giving up until the next resize. */
const FIT_TRIES = 40;
const encoder = new TextEncoder();
/** xterm's `onBinary` is a byte string (non-UTF-8 mouse reports): one char per byte. */
const bytesOf = (binary: string) => Uint8Array.from(binary, (c) => c.charCodeAt(0) & 0xff);

async function load() {
  const [xterm, fit, unicode, links] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit"), import("@xterm/addon-unicode11"), import("@xterm/addon-web-links")]);
  return { Terminal: xterm.Terminal, FitAddon: fit.FitAddon, Unicode11Addon: unicode.Unicode11Addon, WebLinksAddon: links.WebLinksAddon };
}

/**
 * One xterm.js 6 terminal (DOM renderer). It is created once, in one effect, from a lazy import (the package may not use
 * `next/dynamic`, and xterm touches `window`), and disposed with the component; callbacks live in a ref, so nothing rebuilds
 * it. It fits its box on the next frame after every resize and reports a size only when the grid changed. Ctrl+` is left to
 * the page (the terminal toggle); Shift+Enter sends a new line instead of Enter; every other key, Escape included, is the program's.
 */
export function TerminalView({ resolvedTheme, inputLabel = "Terminal input", className, ...callbacks }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const cb = useRef({ ...callbacks, inputLabel });
  useEffect(() => {
    cb.current = { ...callbacks, inputLabel };
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let frame = 0;
    let observer: ResizeObserver | null = null;
    let made: Terminal | null = null;
    void (async () => {
      const x = await load();
      await document.fonts.ready;
      if (disposed) return;
      const t = new x.Terminal({
        // `term.unicode` (the unicode11 widths Claude Code's frame needs for emoji and CJK) is a proposed API.
        allowProposedApi: true,
        cursorBlink: true,
        fontFamily: FONT,
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 5000,
        screenReaderMode: false,
        theme: readTheme(el),
        linkHandler: { activate: (_e, uri) => cb.current.onLink(uri) },
      });
      made = t;
      const fit = new x.FitAddon();
      t.loadAddon(fit);
      t.loadAddon(new x.Unicode11Addon());
      t.unicode.activeVersion = "11";
      t.loadAddon(new x.WebLinksAddon((_e, uri) => cb.current.onLink(uri)));
      t.attachCustomKeyEventHandler((e) => {
        const route = keyRoute(e);
        if (route === "program") return true;
        if (route === "newline") {
          e.preventDefault();
          if (e.type === "keydown") cb.current.onInput(encoder.encode(SHIFT_ENTER));
        }
        return false;
      });
      t.onData((d) => cb.current.onInput(encoder.encode(d)));
      t.onBinary((d) => cb.current.onInput(bytesOf(d)));
      t.open(el);
      t.textarea?.setAttribute("aria-label", cb.current.inputLabel);
      term.current = t;
      let last = "";
      const measure = (tries: number) => {
        frame = 0;
        const d = fit.proposeDimensions();
        if (!d || !(d.cols > 0) || !(d.rows > 0)) {
          if (tries > 0 && el.getClientRects().length > 0) frame = requestAnimationFrame(() => measure(tries - 1));
          return;
        }
        fit.fit();
        const size = `${t.cols}x${t.rows}`;
        if (size === last) return;
        last = size;
        cb.current.onSize({ cols: t.cols, rows: t.rows });
      };
      observer = new ResizeObserver(() => {
        if (!frame) frame = requestAnimationFrame(() => measure(FIT_TRIES));
      });
      observer.observe(el);
      measure(FIT_TRIES);
      cb.current.onReady({ write: (b) => t.write(b), reset: () => t.reset(), focus: () => t.focus() });
    })();
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      made?.dispose();
      term.current = null;
    };
  }, []);

  // The tokens change with the theme class; read them again (no cache) when the resolved theme does.
  useEffect(() => {
    const t = term.current;
    const el = host.current;
    if (t && el) t.options.theme = readTheme(el);
  }, [resolvedTheme]);

  return <div className={cn("min-h-0 min-w-0 flex-1 bg-(--terminal-bg) ps-2 pt-1", className)} data-slot="terminal" ref={host} />;
}
