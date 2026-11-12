import { centsOff, freqToMidi } from "./music.ts";
import type { NoteEv } from "./songs.ts";
import type { Speed } from "./speed.ts";

export interface Frame {
  /** song beat of this analysis frame */
  beat: number;
  freq: number;
  clarity: number;
  rms: number;
  onset: boolean;
}
export type PitchVerdict = "super" | "hoch" | "tief" | "viel-hoch" | "viel-tief" | "verpasst";
export type TimeVerdict = "ok" | "frueh" | "spaet" | "none";
export interface Judgement {
  index: number;
  note: NoteEv;
  pitch: PitchVerdict;
  time: TimeVerdict;
  cents: number;
  /** ms, + = late */
  dtMs: number;
  points: number;
  bonus: number;
  combo: number;
  attempts: number;
}

export const STAR_THRESHOLDS = [0.5, 0.7, 0.88] as const;
export const starsFor = (accuracy: number) => STAR_THRESHOLDS.filter((t) => accuracy >= t - 1e-9).length as 0 | 1 | 2 | 3;

export const PITCH_MAX = 70;
export const TIME_MAX = 30;

export function pitchFactor(absCents: number, tol: number) {
  if (absCents <= tol) return 1;
  if (absCents <= 3 * tol) return 1 - (0.7 * (absCents - tol)) / (2 * tol);
  if (absCents <= 150) return 0.15;
  return 0;
}
export function timingFactor(absMs: number, goodMs: number) {
  if (absMs <= goodMs) return 1;
  const ok = goodMs * 2.5;
  if (absMs <= ok) return 1 - (0.6 * (absMs - goodMs)) / (ok - goodMs);
  return 0.3;
}
export function pitchVerdict(cents: number, tol: number): PitchVerdict {
  const a = Math.abs(cents);
  if (a <= tol) return "super";
  if (a <= 100) return cents > 0 ? "hoch" : "tief";
  return cents > 0 ? "viel-hoch" : "viel-tief";
}
export const comboBonus = (combo: number) => Math.min(combo, 10) * 2;

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface Acc {
  cents: number[];
  frames: number;
  onsetBeat: number | null;
  attempts: number;
  wrongRun: number;
  goodRun: number[];
  fresh: boolean;
}

const MIN_CLARITY = 0.8;

/**
 * Turns a stream of pitch frames into per-note judgements.
 * Normal mode: notes are judged when their time window has passed.
 * Wait mode: the current note is accepted once a fresh, steady, correct pitch is heard; `waiting` tells the session to freeze the clock.
 */
export class Judge {
  readonly results: Judgement[] = [];
  combo = 0;
  maxCombo = 0;
  private cur = 0;
  private acc: Acc[];
  private lastMidiRounded: number | null = null;
  /** live hint while waiting, e.g. "hoch" when the child plays too sharp */
  liveHint: PitchVerdict | null = null;
  liveCents = 0;

  readonly notes: NoteEv[];
  readonly speed: Speed;
  readonly spb: number;
  constructor(notes: NoteEv[], speed: Speed, spb: number) {
    this.notes = notes;
    this.speed = speed;
    this.spb = spb;
    // a note after a different pitch counts as fresh; a repeated pitch needs a new bow stroke (onset)
    this.acc = notes.map((n, i) => ({ cents: [], frames: 0, onsetBeat: null, attempts: 0, wrongRun: 0, goodRun: [], fresh: i === 0 || notes[i - 1].midi !== n.midi }));
  }

  get index() {
    return this.cur;
  }
  get done() {
    return this.cur >= this.notes.length;
  }
  /** beats a note may be started early */
  get earlyBeats() {
    return Math.min(0.5, 0.22 / this.spb);
  }
  get goodMs() {
    return Math.max(110, 0.2 * this.spb * 1000);
  }
  /** wait mode: a note played on time is accepted within this grace, so the music does not stutter */
  get graceBeats() {
    return Math.min(0.35, 0.25 / this.spb);
  }
  /** wait mode: beat at which the clock holds for the current note */
  holdBeat() {
    return this.done ? Infinity : this.notes[this.cur].start + this.graceBeats;
  }
  /** wait mode: true when the clock must hold for the current note */
  shouldHoldAt(beat: number) {
    return this.speed.wait && !this.done && beat >= this.holdBeat();
  }

  push(f: Frame): Judgement[] {
    const out: Judgement[] = [];
    const pitched = f.freq > 0 && f.clarity >= MIN_CLARITY;
    const midiF = pitched ? freqToMidi(f.freq) : null;
    const rounded = midiF === null ? null : Math.round(midiF);
    const pitchArrival = rounded !== null && rounded !== this.lastMidiRounded;
    this.lastMidiRounded = rounded;
    if (!this.speed.wait) {
      // finalise every note whose time has passed
      while (!this.done && f.beat >= this.notes[this.cur].start + this.notes[this.cur].dur) out.push(this.finalise(this.cur++));
      if (this.done) return out;
      const k = this.cur;
      const n = this.notes[k];
      if (f.beat < n.start - this.earlyBeats) return out;
      // overlap zone: the next note may start a little early; frames go to the note they match better
      let target = k;
      const nx = this.notes[k + 1];
      if (nx && f.beat >= nx.start - Math.min(this.earlyBeats, 0.4 * n.dur)) {
        if (midiF !== null) {
          const cn = Math.abs(centsOff(f.freq, nx.midi!));
          const cc = Math.abs(centsOff(f.freq, n.midi!));
          if (cn < cc || (cn === cc && f.onset)) target = k + 1;
        }
      }
      const tn = this.notes[target];
      const a = this.acc[target];
      a.frames++;
      if (midiF !== null) a.cents.push(centsOff(f.freq, tn.midi!));
      if (a.onsetBeat === null && (f.onset || pitchArrival) && midiF !== null && Math.abs(centsOff(f.freq, tn.midi!)) < 150) a.onsetBeat = f.beat;
      return out;
    }
    // ---- wait mode ----
    if (this.done) return out;
    const n = this.notes[this.cur];
    if (f.beat < n.start - this.earlyBeats) return out;
    const a = this.acc[this.cur];
    if (f.onset || pitchArrival || midiF === null) a.fresh = a.fresh || f.onset || pitchArrival;
    if (midiF === null) {
      a.goodRun = [];
      a.wrongRun = 0;
      this.liveHint = null;
      return out;
    }
    const c = centsOff(f.freq, n.midi!);
    this.liveCents = c;
    if (Math.abs(c) <= this.speed.acceptTol) {
      a.goodRun.push(c);
      a.wrongRun = 0;
      if (a.goodRun.length >= 3 && a.fresh) {
        a.cents = a.goodRun;
        a.onsetBeat = f.beat;
        out.push(this.finalise(this.cur++));
        this.liveHint = null;
      }
    } else {
      a.goodRun = [];
      // the previous note still ringing (or played into the early window) is not a wrong attempt
      const prev = this.cur > 0 ? this.notes[this.cur - 1].midi : null;
      if (f.beat < n.start || (prev !== null && Math.abs(centsOff(f.freq, prev)) <= this.speed.acceptTol)) {
        a.wrongRun = 0;
        return out;
      }
      a.wrongRun++;
      if (a.wrongRun === 3) a.attempts++;
      if (a.wrongRun >= 3) this.liveHint = pitchVerdict(c, this.speed.tol);
      // a stable wrong note followed by the right one is a fresh arrival
      a.fresh = true;
    }
    return out;
  }

  /** finish all remaining notes (normal mode at song end) */
  flush(): Judgement[] {
    const out: Judgement[] = [];
    while (!this.done) out.push(this.finalise(this.cur++));
    return out;
  }

  private finalise(i: number): Judgement {
    const n = this.notes[i];
    const a = this.acc[i];
    const tol = this.speed.tol;
    let cents = 0;
    let pv: PitchVerdict;
    const needed = Math.max(2, Math.round(0.25 * a.frames));
    if (a.cents.length < needed || a.cents.length === 0) pv = "verpasst";
    else {
      const near = a.cents.filter((c) => Math.abs(c) < 250);
      cents = median(near.length >= a.cents.length * 0.4 ? near : a.cents);
      pv = pitchVerdict(cents, tol);
    }
    let tv: TimeVerdict = "none";
    let dtMs = 0;
    let tf = 0;
    if (pv !== "verpasst") {
      if (this.speed.wait) {
        tv = "ok";
        tf = 1;
      } else if (a.onsetBeat !== null) {
        dtMs = (a.onsetBeat - n.start) * this.spb * 1000;
        tf = timingFactor(Math.abs(dtMs), this.goodMs);
        tv = Math.abs(dtMs) <= this.goodMs ? "ok" : dtMs < 0 ? "frueh" : "spaet";
      } else tf = 0.6;
    }
    let pf = pv === "verpasst" ? 0 : pitchFactor(Math.abs(cents), tol);
    if (this.speed.wait) pf = Math.max(0, pf - Math.min(0.43, a.attempts * 0.14));
    const points = Math.round(PITCH_MAX * pf + TIME_MAX * tf);
    if (pv === "super") this.combo++;
    else this.combo = 0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const bonus = pv === "super" ? comboBonus(this.combo) : 0;
    const j: Judgement = { index: i, note: n, pitch: pv, time: tv, cents, dtMs, points, bonus, combo: this.combo, attempts: a.attempts };
    this.results.push(j);
    return j;
  }
}

export interface Summary {
  notes: number;
  base: number;
  bonus: number;
  score: number;
  accuracy: number;
  stars: 0 | 1 | 2 | 3;
  perfect: number;
  maxCombo: number;
  /** accuracy per bar index */
  barAccuracy: Map<number, number>;
}
export function summarise(results: Judgement[], maxCombo: number): Summary {
  const base = results.reduce((s, r) => s + r.points, 0);
  const bonus = results.reduce((s, r) => s + r.bonus, 0);
  const accuracy = results.length ? base / (100 * results.length) : 0;
  const bars = new Map<number, number[]>();
  for (const r of results) {
    const l = bars.get(r.note.bar) ?? [];
    l.push(r.points / 100);
    bars.set(r.note.bar, l);
  }
  const barAccuracy = new Map([...bars].map(([b, l]) => [b, l.reduce((x, y) => x + y, 0) / l.length]));
  return {
    notes: results.length,
    base,
    bonus,
    score: base + bonus,
    accuracy,
    stars: starsFor(accuracy),
    perfect: results.filter((r) => r.pitch === "super" && (r.time === "ok" || r.time === "none")).length,
    maxCombo,
    barAccuracy,
  };
}

/** The two-bar passage with the lowest accuracy (for "Diese Stelle üben"). */
export function worstPassage(barAccuracy: Map<number, number>, barCount: number, len = 2): { from: number; to: number; accuracy: number } | null {
  let best: { from: number; to: number; accuracy: number } | null = null;
  for (let b = 0; b + len - 1 < barCount; b++) {
    const vals: number[] = [];
    for (let k = b; k < b + len; k++) if (barAccuracy.has(k)) vals.push(barAccuracy.get(k)!);
    if (!vals.length) continue;
    const acc = vals.reduce((x, y) => x + y, 0) / vals.length;
    if (!best || acc < best.accuracy - 1e-9) best = { from: b, to: b + len - 1, accuracy: acc };
  }
  return best;
}
