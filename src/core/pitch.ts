// YIN monophonic pitch detector (de Cheveigné & Kawahara 2002), tuned for violin (G3 196 Hz .. ~2.6 kHz).
export interface PitchResult {
  /** Hz, or 0 when no confident pitch */
  freq: number;
  /** 0..1, 1 = perfectly periodic */
  clarity: number;
  /** RMS of the analysed frame */
  rms: number;
}

export interface YinOptions {
  minFreq?: number;
  maxFreq?: number;
  threshold?: number;
  /** frames quieter than this RMS are treated as silence */
  gate?: number;
}

export class Yin {
  private diff: Float32Array;
  readonly tauMin: number;
  readonly tauMax: number;
  private threshold: number;
  gate: number;
  readonly sampleRate: number;
  readonly frameSize: number;
  constructor(sampleRate: number, frameSize: number, o: YinOptions = {}) {
    this.sampleRate = sampleRate;
    this.frameSize = frameSize;
    this.tauMin = Math.max(2, Math.floor(sampleRate / (o.maxFreq ?? 2700)));
    this.tauMax = Math.min(Math.floor(frameSize / 2), Math.ceil(sampleRate / (o.minFreq ?? 170)));
    this.threshold = o.threshold ?? 0.15;
    this.gate = o.gate ?? 0.004;
    this.diff = new Float32Array(this.tauMax + 2);
  }

  detect(buf: Float32Array): PitchResult {
    const n = buf.length;
    let e = 0;
    for (let i = 0; i < n; i++) e += buf[i] * buf[i];
    const rms = Math.sqrt(e / n);
    if (rms < this.gate) return { freq: 0, clarity: 0, rms };
    const W = n - this.tauMax - 1;
    if (W < 64) throw new Error("frame too short for tauMax");
    const d = this.diff;
    // difference function
    for (let tau = 1; tau <= this.tauMax + 1; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) {
        const x = buf[i] - buf[i + tau];
        s += x * x;
      }
      d[tau] = s;
    }
    // cumulative mean normalised difference
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= this.tauMax + 1; tau++) {
      run += d[tau];
      d[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    }
    // absolute threshold: first dip below threshold, then walk to its local minimum
    let tau = -1;
    for (let t = this.tauMin; t <= this.tauMax; t++) {
      if (d[t] < this.threshold) {
        while (t + 1 <= this.tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      // fall back to the global minimum if it is reasonably periodic
      let best = this.tauMin;
      for (let t = this.tauMin + 1; t <= this.tauMax; t++) if (d[t] < d[best]) best = t;
      if (d[best] > 0.35) return { freq: 0, clarity: Math.max(0, 1 - d[best]), rms };
      tau = best;
    }
    // parabolic interpolation
    const a = d[tau - 1] ?? d[tau];
    const b = d[tau];
    const c = d[tau + 1] ?? d[tau];
    const den = a + c - 2 * b;
    const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
    const t = tau + Math.max(-1, Math.min(1, shift));
    return { freq: this.sampleRate / t, clarity: Math.max(0, Math.min(1, 1 - b)), rms };
  }
}

/** Simple energy onset detector over a stream of frame RMS values (bow changes, new strokes). */
export class OnsetDetector {
  private hist: number[] = [];
  private lastOnset = -1e9;
  private histLen: number;
  private ratio: number;
  private refractory: number;
  constructor(histLen = 6, ratio = 1.8, refractory = 0.09) {
    this.histLen = histLen;
    this.ratio = ratio;
    this.refractory = refractory;
  }
  /** returns true when `rms` at time `t` (s) is an onset */
  push(rms: number, t: number, gate: number): boolean {
    const min = this.hist.length ? Math.min(...this.hist) : 0;
    this.hist.push(rms);
    if (this.hist.length > this.histLen) this.hist.shift();
    if (rms < gate * 1.5) return false;
    if (t - this.lastOnset < this.refractory) return false;
    if (rms > Math.max(min, gate) * this.ratio) {
      this.lastOnset = t;
      return true;
    }
    return false;
  }
}
