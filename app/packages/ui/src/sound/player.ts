import { higherTone, type Tone } from "./tones";

// The sound's rules without React or the browser (P59 verdict 8a, 8b), so a unit test can hold them. A burst plays one tone:
// tones offered within `burstMs` of the first collapse into the highest; at most one tone every `gapMs`. Nothing plays
// before a gesture unlocked the audio (browsers start a context suspended), while muted, or in a tab that does not hold the
// sound lock; such a tone is dropped, never kept for later.

/** The audio as the player needs it; the hook builds it from `AudioContext`, a test from a fake. */
export interface SoundAudio {
  running(): boolean;
  resume(): Promise<void>;
  play(tone: Tone): void;
  close(): void;
}

export interface SoundDeps {
  /** A new audio context, or null where the browser has none. Called on the first gesture only. */
  newAudio: () => SoundAudio | null;
  now: () => number;
  later: (fn: () => void, ms: number) => () => void;
  /** Requests the one lock of all tabs (`hub-sound`); calls `onHeld` once it is held. Returns its release. */
  lock: (onHeld: () => void) => () => void;
  /** This tab now holds the lock (it plays, and refetches the feed while hidden). */
  onHolder?: (held: boolean) => void;
}

export const BURST_MS = 1_500;
export const GAP_MS = 4_000;

export function createSoundPlayer(d: SoundDeps, o: { burstMs?: number; gapMs?: number } = {}) {
  const burstMs = o.burstMs ?? BURST_MS;
  const gapMs = o.gapMs ?? GAP_MS;
  let audio: SoundAudio | null = null;
  let held = false;
  let muted = false;
  let pending: Tone | null = null;
  let openedAt = 0;
  let lastAt = Number.NEGATIVE_INFINITY;
  let cancel: (() => void) | null = null;
  let release: (() => void) | null = null;

  const ready = (): boolean => !muted && held && audio !== null && audio.running();
  function fire(): void {
    cancel = null;
    const t = pending;
    pending = null;
    if (!t || !audio || !ready()) return;
    lastAt = d.now();
    audio.play(t);
  }
  function drop(): void {
    pending = null;
    cancel?.();
    cancel = null;
  }
  return {
    /** A gesture in the page: create or resume the audio, then ask for the lock. True once the audio runs. */
    async unlock(): Promise<boolean> {
      audio ??= d.newAudio();
      if (!audio) return false;
      if (!audio.running()) await audio.resume().catch(() => undefined);
      if (!audio.running()) return false;
      release ??= d.lock(() => {
        held = true;
        d.onHolder?.(true);
      });
      return true;
    },
    /** A turn's tone. Dropped unless it can play now; else it joins the burst that is open. */
    offer(tone: Tone): void {
      if (!ready()) return;
      pending = higherTone(pending, tone);
      if (cancel) return;
      openedAt = d.now();
      const at = Math.max(openedAt + burstMs, lastAt + gapMs);
      cancel = d.later(fire, Math.max(0, at - d.now()));
    },
    setMuted(on: boolean): void {
      muted = on;
      if (on) drop();
    },
    dispose(): void {
      drop();
      release?.();
      release = null;
      if (held) d.onHolder?.(false);
      held = false;
      audio?.close();
      audio = null;
    },
  };
}
export type SoundPlayer = ReturnType<typeof createSoundPlayer>;
