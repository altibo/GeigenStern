// Pitch helpers and violin first-position fingering.
export type StringName = "G" | "D" | "A" | "E";
export const STRINGS: { name: StringName; midi: number }[] = [
  { name: "G", midi: 55 },
  { name: "D", midi: 62 },
  { name: "A", midi: 69 },
  { name: "E", midi: 76 },
];
export const STRING_MIDI: Record<StringName, number> = { G: 55, D: 62, A: 69, E: 76 };

// Concert pitch ("Kammerton") for A4. Everything (tuner, scoring, backing, guide tone) goes through midiToFreq/freqToMidi.
export const A4_MIN = 415;
export const A4_MAX = 466;
export const A4_PRESETS = [432, 440, 442] as const;
let A4 = 440;
export const clampA4 = (hz: number) => Math.max(A4_MIN, Math.min(A4_MAX, Math.round(Number(hz) || 440)));
export function setA4(hz: number) {
  A4 = clampA4(hz);
  return A4;
}
export const getA4 = () => A4;
/** Round a measured open-A frequency to a reference (1 Hz), or null when it is not plausibly an A string. */
export function a4FromMeasurement(freqs: number[]): number | null {
  const ok = freqs.filter((f) => f >= A4_MIN - 5 && f <= A4_MAX + 5).sort((a, b) => a - b);
  if (ok.length < 5) return null;
  const med = ok[ok.length >> 1];
  return clampA4(med);
}
export const midiToFreq = (m: number) => A4 * 2 ** ((m - 69) / 12);
export const freqToMidi = (f: number) => 69 + 12 * Math.log2(f / A4);
/** Signed distance in cents from `f` to the equal-tempered target midi note. */
export const centsOff = (f: number, midi: number) => 1200 * Math.log2(f / midiToFreq(midi));

const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "H"];
/** German note name (H for B) with octave, e.g. "A4", "F♯4", "H3". */
export const noteName = (m: number) => `${SHARP_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
/** German short name without octave, e.g. "F♯", "H". */
export const pitchClassName = (m: number) => SHARP_NAMES[((m % 12) + 12) % 12];

/**
 * Finger for a note on a string in first position, or null when not playable there.
 * Semitones above the open string: 0 open, 1 low-1, 2 one, 3 low-2, 4 high-2, 5 three, 6 high-3, 7 four.
 */
export function firstPositionFinger(midi: number, s: StringName): 0 | 1 | 2 | 3 | 4 | null {
  const d = midi - STRING_MIDI[s];
  const map: Record<number, 0 | 1 | 2 | 3 | 4> = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4 };
  return d in map ? map[d] : null;
}

/** Beginner fingering: the lowest-finger choice on the highest string that reaches the note (prefers open strings over 4th finger). */
export function suggestFingering(midi: number): { string: StringName; finger: 0 | 1 | 2 | 3 | 4 } | null {
  let best: { string: StringName; finger: 0 | 1 | 2 | 3 | 4 } | null = null;
  for (const s of STRINGS) {
    const f = firstPositionFinger(midi, s.name);
    if (f === null) continue;
    if (!best || f < best.finger) best = { string: s.name, finger: f };
  }
  return best;
}

// ---- staff positions ----
const LETTER_OF_PC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // C C# D D# E F F# G G# A A# B as sharp spelling
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
/** Diatonic step relative to E4 (bottom staff line = 0, each line/space +1) using sharp spelling. */
export function staffStep(midi: number): { step: number; sharp: boolean } {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const letter = LETTER_OF_PC[pc];
  const sharp = NATURAL_PC[letter] !== pc;
  const diatonic = oct * 7 + letter; // C4 = 28
  return { step: diatonic - (4 * 7 + 2), sharp };
}
