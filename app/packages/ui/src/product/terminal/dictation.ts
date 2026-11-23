import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { useHotkey } from "../../use-hotkey";
import { resolveSpeechLanguage } from "./speech-language";
import { saveSpeechLanguagePreference, useSpeechLanguagePreference } from "./storage";

export type TerminalSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: TerminalSpeechEvent) => void) | null;
  onerror: ((event: { readonly error?: string }) => void) | null;
  onend: (() => void) | null;
};

export type TerminalSpeechEvent = {
  readonly results: {
    readonly length: number;
    readonly [index: number]: { readonly [index: number]: { readonly transcript: string } | undefined } | undefined;
  };
};

type Constructor = new () => TerminalSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: Constructor;
    webkitSpeechRecognition?: Constructor;
  }
}

export function terminalSpeechConstructor(): Constructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function transcriptOf(event: TerminalSpeechEvent): string {
  const parts: string[] = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const text = event.results[index]?.[0]?.transcript.trim();
    if (text) parts.push(text);
  }
  return parts.join(" ");
}

const isTerminalInputTarget = (event: KeyboardEvent): boolean => event.target instanceof Element && event.target.closest(".xterm") !== null;
const noSubscribe = () => () => undefined;
const speechAvailable = () => terminalSpeechConstructor() !== undefined;
const speechUnavailableOnServer = () => false;

export function useTerminalDictation(screen: RefObject<{ paste: (text: string) => void; focus: () => void } | null>) {
  const available = useSyncExternalStore(noSubscribe, speechAvailable, speechUnavailableOnServer);
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const storedLanguage = useSpeechLanguagePreference();
  // The owner's pick, when the stored preference could not be written (storage refused); the stored one wins otherwise.
  const [chosen, setChosen] = useState<string | null>(null);
  const browserLanguage = useSyncExternalStore(noSubscribe, resolveSpeechLanguage, () => "en-US");
  const language = storedLanguage ?? chosen ?? browserLanguage;
  const recognition = useRef<TerminalSpeechRecognition | null>(null);
  const transcript = useRef("");
  const stopping = useRef(false);
  const sending = useRef(false);

  useEffect(() => {
    return () => {
      stopping.current = true;
      recognition.current?.abort();
      recognition.current = null;
    };
  }, []);

  const finish = useCallback(() => {
    const send = sending.current;
    sending.current = false;
    const text = transcript.current.trim();
    if (text || send) {
      screen.current?.paste(text ? `${text}${send ? "\r" : " "}` : "\r");
      screen.current?.focus();
    }
    transcript.current = "";
    setPreview("");
    setError(null);
    setRecording(false);
    recognition.current = null;
  }, [screen]);

  const toggle = useCallback(() => {
    if (recording) {
      stopping.current = true;
      sending.current = false;
      recognition.current?.stop();
      return;
    }
    const Recognition = terminalSpeechConstructor();
    if (!Recognition) {
      setError("Dictation is unavailable in this Chrome");
      return;
    }
    stopping.current = false;
    transcript.current = "";
    setPreview("");
    const next = new Recognition();
    recognition.current = next;
    let before = "";
    next.continuous = true;
    next.interimResults = true;
    next.lang = language;
    next.onresult = (event) => {
      const current = transcriptOf(event);
      transcript.current = [before, current].filter(Boolean).join(" ");
      setPreview(transcript.current);
    };
    next.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      finish();
    };
    next.onend = () => {
      if (!stopping.current && recognition.current === next) {
        try {
          before = transcript.current;
          next.start();
          return;
        } catch {
          finish();
          return;
        }
      }
      if (stopping.current) finish();
    };
    try {
      next.start();
      setRecording(true);
    } catch {
      finish();
    }
  }, [finish, language, recording]);

  const send = useCallback(() => {
    if (!recording) return;
    stopping.current = true;
    sending.current = true;
    recognition.current?.stop();
    if (!recognition.current) finish();
  }, [finish, recording]);

  useHotkey("mod+d", toggle, available, { allowInInput: true, capture: true, isAllowedTarget: isTerminalInputTarget });
  useHotkey("enter", send, recording, { allowInInput: true, capture: true, isAllowedTarget: isTerminalInputTarget });
  const chooseLanguage = useCallback((tag: string) => {
    setChosen(tag);
    saveSpeechLanguagePreference(tag);
  }, []);
  return { available, error, language, recording, preview, toggle, chooseLanguage };
}
