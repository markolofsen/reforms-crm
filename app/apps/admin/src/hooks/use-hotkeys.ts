"use client";

import { useEffect, useRef } from "react";
import { load, save, useStored } from "@/lib/storage";

/** Where a key belongs to the control, not to the page: fields, and the open menu, list or dialog (menus jump by first letter). The one guard of every page shortcut, Shift+Enter included. */
export const TYPING = "input,textarea,select,[contenteditable],[role=combobox],[role=listbox],[role=menu],[role=menuitem],[role=dialog]";

/** Whether a key event from `target` is the control's own. */
export const isTypingTarget = (target: EventTarget | null): boolean => target instanceof Element && target.closest(TYPING) !== null;
export const CHORD_WINDOW_MS = 800;

/**
 * Lower-case key to handler. A chord is two keys with a space: `"g d"`. A modifier chord is `"ctrl+<key>"` (the terminal's
 * Ctrl+`). Handlers see the latest render, the listener stays one.
 */
export type KeyMap = Record<string, (e: KeyEventLike) => void>;

/** The part of a keyboard event the dispatcher reads, so it runs without a DOM. `ctrl`: Control alone is held (no Meta, Alt or Shift). */
export type KeyEventLike = { key: string; typing: boolean; modifier: boolean; ctrl?: boolean; preventDefault: () => void };

export type Timers = { set: (fn: () => void, ms: number) => number; clear: (id: number) => void };
const browserTimers: Timers = { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id) };

/**
 * Single keys and two-key chords with the guards every shortcut has: never while a person types or holds a modifier.
 * The pending first key of a chord lasts `CHORD_WINDOW_MS`, resets on any other key and fires the chord once. A modifier
 * chord (`ctrl+``) is the one kind that fires while a field or the terminal has focus: nothing types with Control held.
 */
export function createDispatcher(getMap: () => KeyMap, isEnabled: () => boolean, timers: Timers = browserTimers) {
  let pending: string | null = null;
  let timer: number | null = null;
  const reset = () => {
    pending = null;
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  return (e: KeyEventLike): void => {
    if (!isEnabled()) {
      reset();
      return;
    }
    const map = getMap();
    if (e.modifier) {
      reset();
      const chord = e.ctrl ? map[`ctrl+${e.key}`] : undefined;
      if (chord) {
        e.preventDefault();
        chord(e);
      }
      return;
    }
    if (e.typing) {
      reset();
      return;
    }
    const key = e.key.toLowerCase();
    // A capital letter is its own key (`A` is Shift+A); it must not fall through to the plain `a`.
    const exact = e.key !== key && e.key.length === 1 ? map[e.key] : undefined;
    if (exact) {
      reset();
      exact(e);
      return;
    }
    if (pending !== null) {
      const chord = `${pending} ${key}`;
      reset();
      const fire = map[chord];
      if (fire) {
        fire(e);
        return;
      }
    }
    const starts = Object.keys(map).some((k) => k.startsWith(`${key} `));
    if (starts) {
      pending = key;
      timer = timers.set(reset, CHORD_WINDOW_MS);
      return;
    }
    map[key]?.(e);
  };
}

// What is live right now, for the `?` help: each mounted `useHotkeys` registers its rows.
const NO_HELP: readonly (readonly [string, string])[] = [];
const live = new Map<symbol, readonly (readonly [string, string])[]>();
export const liveKeys = (): (readonly [string, string])[] => [...live.values()].flat();

/**
 * Registers keys for as long as the caller is mounted (pass a module-level `help` array). `enabled` may be a function so a chord can read the remembered
 * switch at press time. `help` rows (`["G E", "go to Mail"]`) feed the live registry.
 */
export function useHotkeys(keys: KeyMap, enabled: boolean | (() => boolean), help: readonly (readonly [string, string])[] = NO_HELP, options: { capture?: boolean } = {}): void {
  const map = useRef(keys);
  const on = useRef(enabled);
  useEffect(() => {
    map.current = keys;
    on.current = enabled;
  });
  useEffect(() => {
    const dispatch = createDispatcher(
      () => map.current,
      () => (typeof on.current === "function" ? on.current() : on.current),
    );
    const capture = options.capture === true;
    // A chord listens in the capture phase and prevents the default, so the single-key listeners (bubble phase)
    // never see the second key of a chord (`g e`) as a single-key shortcut.
    const onKey = (e: KeyboardEvent) => {
      if (!capture && e.defaultPrevented) return;
      dispatch({
        key: e.key,
        typing: isTypingTarget(e.target),
        modifier: e.metaKey || e.ctrlKey || e.altKey,
        ctrl: e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey,
        preventDefault: () => e.preventDefault(),
      });
    };
    window.addEventListener("keydown", onKey, capture);
    return () => window.removeEventListener("keydown", onKey, capture);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the phase is fixed for the life of the caller
  }, []);
  const id = useRef(Symbol("hotkeys"));
  useEffect(() => {
    const key = id.current;
    live.set(key, help);
    return () => void live.delete(key);
  }, [help]);
}

/** Whether shortcuts are on (default on), and the switch. The choice is remembered; the first render is the default (hydration). */
export function useShortcutsSwitch(): [boolean, (on: boolean) => void] {
  const on = useStored("shortcuts") !== "off";
  return [on, (next) => save("shortcuts", next ? "on" : "off")];
}

/** The remembered switch, read at press time (for keys that live outside the screen that shows the switch). */
export const shortcutsOn = (): boolean => load("shortcuts") !== "off";
