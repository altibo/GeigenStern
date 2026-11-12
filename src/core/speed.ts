export type SpeedId = "normal" | "turtle" | "snail";
export interface Speed {
  id: SpeedId;
  label: string;
  emoji: string;
  factor: number;
  /** wait for the correct note instead of running on */
  wait: boolean;
  /** cents counted as "Super!" */
  tol: number;
  /** cents that release a waiting note */
  acceptTol: number;
}
export const SPEEDS: Record<SpeedId, Speed> = {
  normal: { id: "normal", label: "Normal", emoji: "🐇", factor: 1, wait: false, tol: 30, acceptTol: 60 },
  turtle: { id: "turtle", label: "Schildkröte", emoji: "🐢", factor: 0.7, wait: true, tol: 40, acceptTol: 60 },
  snail: { id: "snail", label: "Schnecke", emoji: "🐌", factor: 0.5, wait: true, tol: 50, acceptTol: 75 },
};
export const effectiveBpm = (bpm: number, s: Speed) => bpm * s.factor;
export const secPerBeat = (bpm: number, s: Speed) => 60 / effectiveBpm(bpm, s);

/** Beat clock that can freeze (wait mode) and resume without jumps. Times in seconds (AudioContext time). */
export class BeatClock {
  private t0 = 0;
  private frozen: number | null = null;
  spb: number;
  constructor(spb: number) {
    this.spb = spb;
  }
  /** beat `startBeat` happens at audio time `at` */
  start(at: number, startBeat: number) {
    this.t0 = at - startBeat * this.spb;
    this.frozen = null;
  }
  beatAt(now: number) {
    return this.frozen ?? (now - this.t0) / this.spb;
  }
  /** audio time of a beat (only meaningful while running) */
  timeOf(beat: number) {
    return this.t0 + beat * this.spb;
  }
  get isFrozen() {
    return this.frozen !== null;
  }
  freeze(beat: number) {
    if (this.frozen === null) this.frozen = beat;
  }
  /** continue from the frozen beat at audio time `now` */
  resume(now: number) {
    if (this.frozen === null) return;
    this.t0 = now - this.frozen * this.spb;
    this.frozen = null;
  }
}
