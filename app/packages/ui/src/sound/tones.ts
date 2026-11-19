// The three tones of the agent activity feed (P59 verdict 8c): synthesised with Web Audio, so there is no audio file, no
// fetch and nothing to license. Each is under 300 ms with a soft attack and an exponential fade. If the owner dislikes them,
// CC0 files generated or recorded for this repo replace this table (their source and licence in a README here).

export const TONES = ["problem", "attention", "ready"] as const;
export type Tone = (typeof TONES)[number];

/** Highest wins when tones collapse: problem, then attention, then ready. */
export const TONE_RANK: Record<Tone, number> = { ready: 1, attention: 2, problem: 3 };
export const higherTone = (a: Tone | null, b: Tone): Tone => (a && TONE_RANK[a] >= TONE_RANK[b] ? a : b);

/** One note: its pitch (Hz), its start after the tone begins and its length (seconds). */
export interface Note { hz: number; at: number; length: number }

/** Two notes up asks for him; one soft note says a draft is ready; two notes down says something went wrong. */
export const TONE_NOTES: Record<Tone, readonly Note[]> = {
  attention: [{ hz: 660, at: 0, length: 0.12 }, { hz: 880, at: 0.13, length: 0.15 }],
  ready: [{ hz: 784, at: 0, length: 0.24 }],
  problem: [{ hz: 523, at: 0, length: 0.12 }, { hz: 392, at: 0.13, length: 0.15 }],
};

/** Peak gain: quiet beside a notification sound of the OS. */
const PEAK = 0.12;

/** Plays one tone on a running context. */
export function playTone(ctx: BaseAudioContext, tone: Tone): void {
  const t0 = ctx.currentTime + 0.01;
  for (const n of TONE_NOTES[tone]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(n.hz, t0 + n.at);
    gain.gain.setValueAtTime(0, t0 + n.at);
    gain.gain.linearRampToValueAtTime(PEAK, t0 + n.at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.length + 0.02);
  }
}
