import { describe, expect, it } from "vitest";
import { createSoundPlayer, type SoundAudio } from "../src/sound/player";
import { higherTone, TONE_NOTES, TONES, type Tone } from "../src/sound/tones";

// P59 S1: the sound's rules, with a fake clock, a fake context and a fake lock.
function rig(o: { locked?: boolean; audio?: boolean } = {}) {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const played: Tone[] = [];
  let running = false;
  const holders: boolean[] = [];
  let held: (() => void) | null = null;
  const audio: SoundAudio = { running: () => running, resume: async () => { running = true; }, play: (t) => played.push(t), close: () => { running = false; } };
  const p = createSoundPlayer({
    newAudio: () => (o.audio === false ? null : audio),
    now: () => now,
    later: (fn, ms) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => { t.live = false; };
    },
    lock: (onHeld) => {
      if (o.locked) held = onHeld; // another tab holds it: granted only when that tab lets go
      else onHeld();
      return () => {};
    },
    onHolder: (h) => holders.push(h),
  });
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.live && x.at <= now)) { t.live = false; t.fn(); }
  };
  return { p, played, holders, advance, grant: () => held?.() };
}

describe("tones", () => {
  it("three tones, each under 300 ms; highest wins", () => {
    expect(TONES).toEqual(["problem", "attention", "ready"]);
    for (const t of TONES) {
      const notes = TONE_NOTES[t];
      const end = Math.max(...notes.map((n) => n.at + n.length));
      expect(end).toBeLessThan(0.3);
    }
    expect(higherTone("ready", "attention")).toBe("attention");
    expect(higherTone("problem", "attention")).toBe("problem");
    expect(higherTone(null, "ready")).toBe("ready");
  });
});

describe("the sound player", () => {
  it("plays nothing before a gesture unlocked the audio", async () => {
    const r = rig();
    r.p.offer("attention");
    r.advance(5_000);
    expect(r.played).toEqual([]);
    expect(await r.p.unlock()).toBe(true);
    expect(r.holders).toEqual([true]);
    r.p.offer("attention");
    r.advance(1_500);
    expect(r.played).toEqual(["attention"]);
  });

  it("a burst gives one tone, the highest", async () => {
    const r = rig();
    await r.p.unlock();
    r.p.offer("ready");
    r.advance(500);
    r.p.offer("problem");
    r.advance(500);
    r.p.offer("attention");
    r.advance(600);
    expect(r.played).toEqual(["problem"]);
  });

  it("at most one tone every 4 s", async () => {
    const r = rig();
    await r.p.unlock();
    r.p.offer("ready");
    r.advance(1_500);
    r.p.offer("attention");
    r.advance(1_500);
    expect(r.played).toEqual(["ready"]);
    r.advance(2_400);
    expect(r.played).toEqual(["ready"]);
    r.advance(100);
    expect(r.played).toEqual(["ready", "attention"]);
  });

  it("muted, nothing plays and a pending tone is dropped", async () => {
    const r = rig();
    await r.p.unlock();
    r.p.offer("attention");
    r.p.setMuted(true);
    r.advance(5_000);
    r.p.offer("problem");
    r.advance(5_000);
    expect(r.played).toEqual([]);
    r.p.setMuted(false);
    r.p.offer("ready");
    r.advance(1_500);
    expect(r.played).toEqual(["ready"]);
  });

  it("a tab that does not hold the lock stays silent until it does", async () => {
    const r = rig({ locked: true });
    await r.p.unlock();
    r.p.offer("attention");
    r.advance(5_000);
    expect(r.played).toEqual([]);
    r.grant();
    r.p.offer("attention");
    r.advance(1_500);
    expect(r.played).toEqual(["attention"]);
  });

  it("without AudioContext nothing unlocks and nothing plays", async () => {
    const r = rig({ audio: false });
    expect(await r.p.unlock()).toBe(false);
    r.p.offer("problem");
    r.advance(5_000);
    expect(r.played).toEqual([]);
  });
});
