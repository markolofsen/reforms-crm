"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSoundPlayer, type SoundAudio, type SoundPlayer } from "./player";
import { playTone, type Tone } from "./tones";

// `useSound` (P59 S1): play one of three synthesised tones. It knows no app: the caller decides what sounds and keeps the
// mute switch. The audio starts on the first pointer or key press anywhere in the page (browser autoplay rule); only the tab
// that holds the Web Lock `hub-sound`, asked for once its audio runs, plays. Nothing runs on the server or without `AudioContext`.

const LOCK = "hub-sound";

function browserAudio(): SoundAudio | null {
  if (typeof AudioContext === "undefined") return null;
  const ctx = new AudioContext();
  return { running: () => ctx.state === "running", resume: () => ctx.resume(), play: (t) => playTone(ctx, t), close: () => void ctx.close().catch(() => undefined) };
}

function holdLock(onHeld: () => void): () => void {
  if (!("locks" in navigator)) {
    onHeld();
    return () => {};
  }
  const stop = new AbortController();
  navigator.locks
    .request(LOCK, { signal: stop.signal }, () =>
      new Promise<void>((release) => {
        onHeld();
        stop.signal.addEventListener("abort", () => release(), { once: true });
      }),
    )
    .catch(() => undefined); // released while waiting: another tab plays
  return () => stop.abort();
}

export interface Sound {
  /** One turn's tone; dropped while muted, before the first gesture, or in a tab that does not play. */
  play: (tone: Tone) => void;
  /** This tab plays (it holds `hub-sound`). */
  holder: boolean;
}

export function useSound({ muted }: { muted: boolean }): Sound {
  const player = useRef<SoundPlayer | null>(null);
  const [holder, setHolder] = useState(false);
  useEffect(() => {
    const p = createSoundPlayer({
      newAudio: browserAudio,
      now: () => performance.now(),
      later: (fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
      lock: holdLock,
      onHolder: setHolder,
    });
    player.current = p;
    const unlock = () => {
      void p.unlock().then((on) => {
        if (!on) return;
        window.removeEventListener("pointerdown", unlock, true);
        window.removeEventListener("keydown", unlock, true);
      });
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      p.dispose();
      player.current = null;
    };
  }, []);
  useEffect(() => player.current?.setMuted(muted), [muted]);
  const play = useCallback((tone: Tone) => player.current?.offer(tone), []);
  return { play, holder };
}
