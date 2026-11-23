import { useSyncExternalStore } from "react";

const KEY = "hub.terminal.speech-language";
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function useSpeechLanguagePreference(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function saveSpeechLanguagePreference(value: string): void {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    return;
  }
  notify();
}
