import { OnsetDetector, Yin } from "../core/pitch.ts";
import { chordAt, chordTones, type Song } from "../core/songs.ts";
import { midiToFreq } from "../core/music.ts";
import type { BeatClock } from "../core/speed.ts";
import workletUrl from "./pitch-worklet.ts?worker&url";

export interface MicFrame {
  /** audio-context time the frame is centred on */
  time: number;
  freq: number;
  clarity: number;
  rms: number;
  onset: boolean;
}

const FRAME = 1024;

/** Audio context, microphone analysis and the synthesized backing band. */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  backingBus!: GainNode;
  clickBus!: GainNode;
  private guideBus!: GainNode;
  private noise!: AudioBuffer;
  private micStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(2048);
  yin: Yin | null = null;
  onsets = new OnsetDetector();
  private micTimer = 0;
  onFrame: ((f: MicFrame) => void) | null = null;
  gate = 0.004;
  /** seconds between sound at the mic and samples in the analyser (from the track settings when the browser reports it) */
  inputLatency = 0.015;

  ensure(): AudioContext {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    }
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.backingBus = ctx.createGain();
    this.backingBus.gain.value = 0.5;
    this.backingBus.connect(this.master);
    this.clickBus = ctx.createGain();
    this.clickBus.gain.value = 0.5;
    this.clickBus.connect(this.master);
    this.guideBus = ctx.createGain();
    this.guideBus.gain.value = 0.35;
    this.guideBus.connect(this.master);
    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
    this.yin = new Yin(ctx.sampleRate, FRAME);
    return ctx;
  }

  get micOn() {
    return !!this.micStream;
  }

  private worklet: AudioWorkletNode | null = null;
  private workletReady: Promise<boolean> | null = null;
  /** "worklet" (off main thread) or "analyser" (fallback) */
  pitchPath: "worklet" | "analyser" | "none" = "none";
  private offset = NaN;

  /**
   * Smooth audio-clock estimate for drawing: ctx.currentTime advances in coarse steps on many phones (one audio
   * buffer at a time), which makes scrolling notes stutter. We map it to performance.now() with a slowly
   * tracked offset instead.
   */
  smoothNow(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    if (ctx.state !== "running") {
      this.offset = NaN;
      return ctx.currentTime;
    }
    const perf = performance.now() / 1000;
    const raw = ctx.currentTime - perf;
    if (Number.isNaN(this.offset) || Math.abs(raw - this.offset) > 0.06) this.offset = raw;
    else this.offset += (raw - this.offset) * 0.02;
    // currentTime is the start of the next render quantum; the mean lag is about half a buffer
    return perf + this.offset;
  }

  private loadWorklet(ctx: AudioContext): Promise<boolean> {
    if (!this.workletReady)
      this.workletReady = (async () => {
        if (!ctx.audioWorklet || new URLSearchParams(location.search).has("noworklet")) return false;
        try {
          await ctx.audioWorklet.addModule(workletUrl);
          return true;
        } catch {
          return false;
        }
      })();
    return this.workletReady;
  }

  async startMic(): Promise<void> {
    const ctx = this.ensure();
    if (!this.micStream) {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      const settings = this.micStream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number };
      if (typeof settings?.latency === "number" && settings.latency > 0 && settings.latency < 0.3) this.inputLatency = settings.latency;
      const src = ctx.createMediaStreamSource(this.micStream);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 150;
      src.connect(hp);
      if (await this.loadWorklet(ctx)) {
        const node = new AudioWorkletNode(ctx, "gs-pitch", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        const mute = ctx.createGain();
        mute.gain.value = 0;
        hp.connect(node).connect(mute).connect(ctx.destination);
        node.port.onmessage = (e: MessageEvent<{ time: number; freq: number; clarity: number; rms: number }>) => this.handle(e.data);
        node.port.postMessage({ gate: this.gate });
        this.worklet = node;
        this.pitchPath = "worklet";
      } else {
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0;
        hp.connect(this.analyser);
        this.pitchPath = "analyser";
      }
    }
    if (!this.worklet && !this.micTimer) this.micTimer = window.setInterval(() => this.analyse(), 20);
  }

  setGate(g: number) {
    this.gate = g;
    this.worklet?.port.postMessage({ gate: g });
  }

  private handle(d: { time: number; freq: number; clarity: number; rms: number }) {
    const time = d.time - this.inputLatency;
    const onset = this.onsets.push(d.rms, time, this.gate);
    this.onFrame?.({ time, freq: d.freq, clarity: d.clarity, rms: d.rms, onset });
  }

  stopMic() {
    window.clearInterval(this.micTimer);
    this.micTimer = 0;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.analyser = null;
    this.worklet?.disconnect();
    this.worklet = null;
  }

  private analyse() {
    if (!this.analyser || !this.ctx || !this.yin) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const frame = this.buf.subarray(this.buf.length - FRAME);
    this.yin.gate = this.gate;
    const r = this.yin.detect(frame);
    this.handle({ time: this.ctx.currentTime - FRAME / 2 / this.ctx.sampleRate, freq: r.freq, clarity: r.clarity, rms: r.rms });
  }

  setBacking(v: number) {
    if (this.ctx) this.backingBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // ---------- instruments ----------
  private env(g: GainNode, t: number, peak: number, a: number, d: number) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  piano(midi: number, t: number, vel = 0.18, dest: AudioNode = this.backingBus) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    g.connect(lp).connect(dest);
    for (const [type, mul, amp] of [
      ["triangle", 1, 1],
      ["sine", 2, 0.35],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = midiToFreq(midi) * mul;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 1.3);
    }
    this.env(g, t, vel, 0.006, 1.1);
  }
  bass(midi: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = midiToFreq(midi);
    const g = ctx.createGain();
    o.connect(g).connect(this.backingBus);
    this.env(g, t, 0.32, 0.015, Math.max(0.2, dur));
    o.start(t);
    o.stop(t + dur + 0.4);
  }
  /** soft pad; returns a stop function (for wait-mode holds) */
  pad(midis: number[], t: number, dur: number | null, vel = 0.05): (at: number) => void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    g.connect(lp).connect(this.backingBus);
    const oscs: OscillatorNode[] = [];
    for (const m of midis)
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = midiToFreq(m);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        oscs.push(o);
      }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.25);
    const stop = (at: number) => {
      g.gain.cancelScheduledValues(at);
      g.gain.setTargetAtTime(0, at, 0.12);
      for (const o of oscs) o.stop(at + 0.8);
    };
    if (dur !== null) stop(t + dur);
    return stop;
  }
  kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    o.connect(g).connect(this.backingBus);
    this.env(g, t, 0.35, 0.003, 0.18);
    o.start(t);
    o.stop(t + 0.3);
  }
  shaker(t: number, vel = 0.05) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "highpass";
    bp.frequency.value = 6000;
    const g = ctx.createGain();
    s.connect(bp).connect(g).connect(this.backingBus);
    this.env(g, t, vel, 0.004, 0.05);
    s.start(t, Math.random() * 0.5, 0.1);
  }
  click(t: number, accent: boolean) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = accent ? 1760 : 1320;
    const g = ctx.createGain();
    o.connect(g).connect(this.clickBus);
    this.env(g, t, accent ? 0.5 : 0.32, 0.001, 0.05);
    o.start(t);
    o.stop(t + 0.1);
  }
  /** flute-like guide melody */
  guide(midi: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = midiToFreq(midi);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const lg = ctx.createGain();
    lg.gain.value = 6;
    lfo.connect(lg).connect(o.detune);
    const o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = midiToFreq(midi);
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    o2.connect(g2);
    const g = ctx.createGain();
    o.connect(g);
    g2.connect(g);
    g.connect(this.guideBus);
    const d = Math.max(0.1, dur - 0.05);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.03);
    g.gain.setValueAtTime(0.45, t + d - 0.04);
    g.gain.linearRampToValueAtTime(0, t + d);
    for (const x of [o, o2, lfo]) {
      x.start(t);
      x.stop(t + d + 0.05);
    }
  }
  /** reference tone for the tuner */
  refTone(midi: number, dur = 1.6) {
    const ctx = this.ensure();
    this.guide(midi, ctx.currentTime + 0.02, dur);
  }
}

const voiceChord = (sym: string, low: number, high: number) => {
  const pcs = chordTones(sym);
  const out: number[] = [];
  for (let m = low; m <= high; m++) if (pcs.includes(m % 12)) out.push(m);
  return { pcs, out, root: pcs[0] };
};

/** Schedules the backing band ahead of a (freezable) beat clock. */
export class Backing {
  private scheduled = -Infinity; // last scheduled half-beat step
  private hold: ((at: number) => void) | null = null;
  metronome = false;
  guideOn = false;
  countInFrom = 0;
  audio: Audio;
  song: Song;
  clock: BeatClock;
  constructor(audio: Audio, song: Song, clock: BeatClock) {
    this.audio = audio;
    this.song = song;
    this.clock = clock;
  }
  reset(fromBeat: number) {
    this.scheduled = fromBeat - 0.5;
    this.countInFrom = fromBeat;
    this.releaseHold();
  }
  releaseHold() {
    const ctx = this.audio.ctx;
    if (this.hold && ctx) this.hold(ctx.currentTime);
    this.hold = null;
  }
  /** keep the current chord sounding while the clock waits */
  holdChord(beat: number) {
    if (this.hold || !this.audio.ctx) return;
    const v = voiceChord(chordAt(this.song, Math.max(0, beat)), 50, 64);
    this.hold = this.audio.pad(v.out, this.audio.ctx.currentTime, null, 0.07);
  }
  /**
   * Schedule all half-beat steps up to `untilBeat` (capped by `barrier`, the beat the clock may freeze at).
   * `endBeat` stops the band at the song end.
   */
  tick(now: number, lookahead: number, barrier: number, endBeat: number) {
    if (this.clock.isFrozen) return;
    const until = Math.min(this.clock.beatAt(now + lookahead), barrier, endBeat);
    const s = this.song;
    const bpb = s.beatsPerBar;
    const spb = this.clock.spb;
    while (this.scheduled + 0.5 < until - 1e-9) {
      const step = Math.round((this.scheduled + 0.5) * 2) / 2;
      this.scheduled = step;
      const t = Math.max(now, this.clock.timeOf(step));
      const inBar = ((step % bpb) + bpb) % bpb;
      const onBeat = Number.isInteger(step);
      if (step < this.countInFrom + bpb) {
        // count-in: always click
        if (onBeat) this.audio.click(t, step === this.countInFrom);
        continue;
      }
      if (this.metronome && onBeat) this.audio.click(t, inBar === 0);
      const sym = chordAt(s, step);
      const v = voiceChord(sym, 55, 72);
      const prevSym = step >= 0.5 ? chordAt(s, step - 0.5) : "";
      const chordStart = sym !== prevSym || (inBar === 0 && onBeat);
      if (chordStart) {
        // pad for the chord's span (up to next change or bar end)
        let len = 0.5;
        while (step + len < endBeat && chordAt(s, step + len) === sym && ((step + len) % bpb !== 0 || len === 0)) len += 0.5;
        const low = voiceChord(sym, 50, 64);
        this.audio.pad(low.out.slice(0, 4), t, len * spb, 0.045);
        const root = 36 + ((v.root - 36 + 1200) % 12) + 12; // D2..C#3 range
        this.audio.bass(root < 40 ? root + 12 : root, t, Math.min(len, 2) * spb * 0.9);
      }
      if (onBeat) {
        if (inBar === 0) this.audio.kick(t);
        // gentle piano: chord tones walking up across the bar
        const k = Math.floor(inBar) % v.out.length;
        this.audio.piano(v.out[(k * 2 + 1) % v.out.length], t, inBar === 0 ? 0.16 : 0.1);
      } else this.audio.shaker(t, 0.04);
      if (this.guideOn)
        for (const n of s.notes) if (n.midi !== null && Math.abs(n.start - step) < 1e-9) this.audio.guide(n.midi, t, n.dur * spb);
      // eighth notes inside a half-beat step
      if (this.guideOn)
        for (const n of s.notes) if (n.midi !== null && n.start > step + 1e-9 && n.start < step + 0.5 - 1e-9) this.audio.guide(n.midi, this.clock.timeOf(n.start), n.dur * spb);
    }
  }
}
