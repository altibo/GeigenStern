// AudioWorklet: runs the YIN pitch detector off the main thread, one result every ~20 ms.
import { Yin } from "../core/pitch.ts";

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const FRAME = 1024;

class PitchProcessor extends AudioWorkletProcessor {
  private ring = new Float32Array(FRAME * 2);
  private w = 0;
  private filled = 0;
  private since = 0;
  private hop = Math.round(sampleRate * 0.02);
  private frame = new Float32Array(FRAME);
  private yin = new Yin(sampleRate, FRAME);
  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ gate?: number }>) => {
      if (typeof e.data.gate === "number") this.yin.gate = e.data.gate;
    };
  }
  process(inputs: Float32Array[][]) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    const n = this.ring.length;
    for (let i = 0; i < ch.length; i++) {
      this.ring[this.w] = ch[i];
      this.w = (this.w + 1) % n;
    }
    this.filled = Math.min(n, this.filled + ch.length);
    this.since += ch.length;
    if (this.since >= this.hop && this.filled >= FRAME) {
      this.since = 0;
      let r = (this.w - FRAME + n) % n;
      for (let i = 0; i < FRAME; i++) {
        this.frame[i] = this.ring[r];
        r = (r + 1) % n;
      }
      const res = this.yin.detect(this.frame);
      // centre of the analysed frame, in context time
      const time = currentTime + ch.length / sampleRate - FRAME / 2 / sampleRate;
      this.port.postMessage({ time, freq: res.freq, clarity: res.clarity, rms: res.rms });
    }
    return true;
  }
}
registerProcessor("gs-pitch", PitchProcessor);
