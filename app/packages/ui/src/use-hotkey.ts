"use client";

import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** The one selector used by every page and control shortcut to detect owned typing surfaces. */
export const TYPING = "input,textarea,select,[contenteditable],[role=combobox],[role=listbox],[role=menu],[role=menuitem],[role=dialog]";

export const isHotkeyTypingTarget = (target: EventTarget | null): boolean => target instanceof Element && target.closest(TYPING) !== null;

type HotkeyRegistration = {
  capture: boolean;
  handle: (event: KeyboardEvent) => void;
  order: number;
  priority: number;
};

type HotkeyRegistry = {
  register: (registration: Omit<HotkeyRegistration, "order">) => () => void;
  /** Runs the registrations of one phase, highest priority first, then in mount order, until one prevents the default. */
  dispatch: (capture: boolean, event: KeyboardEvent) => void;
};

function createHotkeyRegistry(): HotkeyRegistry {
  let registrations: HotkeyRegistration[] = [];
  let nextOrder = 0;
  return {
    register: (registration) => {
      const entry = { ...registration, order: nextOrder++ };
      registrations.push(entry);
      return () => {
        registrations = registrations.filter((candidate) => candidate !== entry);
      };
    },
    dispatch: (capture, event) => {
      const ordered = registrations
        .filter((entry) => entry.capture === capture)
        .sort((left, right) => right.priority - left.priority || left.order - right.order);
      for (const entry of ordered) {
        if (event.defaultPrevented) break;
        entry.handle(event);
      }
    },
  };
}

const HotkeyRegistryContext = createContext<HotkeyRegistry | null>(null);

export function HotkeyProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createHotkeyRegistry);

  useEffect(() => {
    const onCapture = (event: KeyboardEvent) => registry.dispatch(true, event);
    const onBubble = (event: KeyboardEvent) => registry.dispatch(false, event);
    window.addEventListener("keydown", onCapture, true);
    window.addEventListener("keydown", onBubble, false);
    return () => {
      window.removeEventListener("keydown", onCapture, true);
      window.removeEventListener("keydown", onBubble, false);
    };
  }, [registry]);

  return createElement(HotkeyRegistryContext.Provider, { value: registry }, children);
}

function matches(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.at(-1);
  if (!key || event.key.toLowerCase() !== key) return false;
  const modifiers = new Set(parts.slice(0, -1));
  const mac = navigator.platform.includes("Mac");
  const mod = modifiers.has("mod");
  return (mod ? (mac ? event.metaKey : event.ctrlKey) : false) === mod
    && event.shiftKey === modifiers.has("shift")
    && event.altKey === modifiers.has("alt")
    && event.ctrlKey === (modifiers.has("ctrl") || (mod && !mac))
    && event.metaKey === (modifiers.has("meta") || (mod && mac));
}

/** A direct modifier shortcut for controls that own their event, such as the editor and terminal dictation. */
export function useHotkey(shortcut: string, onPress: () => void, enabled = true, options: { capture?: boolean; allowInInput?: boolean; allowRepeat?: boolean; priority?: number; isAllowedTarget?: (event: KeyboardEvent) => boolean } = {}): void {
  const registry = useContext(HotkeyRegistryContext);
  const capture = options.capture === true;
  const allowInInput = options.allowInInput === true;
  const allowRepeat = options.allowRepeat === true;
  const priority = options.priority ?? 100;
  const isAllowedTarget = options.isAllowedTarget;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matches(event, shortcut)) return;
      if (event.repeat && !allowRepeat) return;
      if (isAllowedTarget && !isAllowedTarget(event)) return;
      if (!allowInInput && (event.defaultPrevented || isHotkeyTypingTarget(event.target))) return;
      event.preventDefault();
      onPress();
    };
    if (registry) return registry.register({ capture, handle: onKeyDown, priority });
    window.addEventListener("keydown", onKeyDown, capture);
    return () => window.removeEventListener("keydown", onKeyDown, capture);
  }, [allowInInput, allowRepeat, capture, enabled, isAllowedTarget, onPress, priority, registry, shortcut]);
}

export const CHORD_WINDOW_MS = 800;

/** A page-level shortcut map. A capital single key stays distinct from its lower-case action. */
export type KeyMap = Record<string, (event: KeyEventLike) => void>;
export type KeyEventLike = { key: string; typing: boolean; modifier: boolean; ctrl?: boolean; preventDefault: () => void };
export type Timers = { set: (fn: () => void, ms: number) => number; clear: (id: number) => void };

const browserTimers: Timers = { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id) };

/** The pure dispatcher shared by every page-level hotkey consumer. */
export function createDispatcher(getMap: () => KeyMap, isEnabled: () => boolean, timers: Timers = browserTimers) {
  let pending: string | null = null;
  let timer: number | null = null;
  const reset = () => {
    pending = null;
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  return (event: KeyEventLike): void => {
    if (!isEnabled()) {
      reset();
      return;
    }
    const map = getMap();
    if (event.modifier) {
      reset();
      const chord = event.ctrl ? map[`ctrl+${event.key}`] : undefined;
      if (chord) {
        event.preventDefault();
        chord(event);
      }
      return;
    }
    if (event.typing) {
      reset();
      return;
    }
    const key = event.key.toLowerCase();
    const exact = event.key !== key && event.key.length === 1 ? map[event.key] : undefined;
    if (exact) {
      reset();
      exact(event);
      return;
    }
    if (pending !== null) {
      const chord = `${pending} ${key}`;
      reset();
      const fire = map[chord];
      if (fire) {
        fire(event);
        return;
      }
    }
    const starts = Object.keys(map).some((shortcut) => shortcut.startsWith(`${key} `));
    if (starts) {
      pending = key;
      timer = timers.set(reset, CHORD_WINDOW_MS);
      return;
    }
    map[key]?.(event);
  };
}

const NO_HELP: readonly (readonly [string, string])[] = [];
const live = new Map<symbol, readonly (readonly [string, string])[]>();

/** Help rows are derived from the same mounted registry that handles the shortcuts. */
export const liveKeys = (): (readonly [string, string])[] => [...live.values()].flat();

export function useHotkeys(keys: KeyMap, enabled: boolean | (() => boolean), help: readonly (readonly [string, string])[] = NO_HELP, options: { capture?: boolean; priority?: number } = {}): void {
  const registry = useContext(HotkeyRegistryContext);
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
    const priority = options.priority ?? 0;
    const onKey = (event: KeyboardEvent) => {
      if (!capture && event.defaultPrevented) return;
      dispatch({
        key: event.key,
        typing: isHotkeyTypingTarget(event.target),
        modifier: event.metaKey || event.ctrlKey || event.altKey,
        ctrl: event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey,
        preventDefault: () => event.preventDefault(),
      });
    };
    if (registry) return registry.register({ capture, handle: onKey, priority });
    window.addEventListener("keydown", onKey, capture);
    return () => window.removeEventListener("keydown", onKey, capture);
    // Key maps and the switch update through refs; the phase and priority re-register.
  }, [options.capture, options.priority, registry]);
  const id = useRef(Symbol("hotkeys"));
  useEffect(() => {
    const key = id.current;
    live.set(key, help);
    return () => void live.delete(key);
  }, [help]);
}
