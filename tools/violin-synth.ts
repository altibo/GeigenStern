// Violin-like test tone generator: bowed-string harmonic series, vibrato, bow noise, attack/release.
export interface ToneOpts {
  sampleRate: number;
  vibratoCents?: number;
  vibratoHz?: number;
  noise?: number;
  /** relative strength of the fundamental (violin G string often has a weak fundamental) */
  fundamental?: number;
  gain?: number;
  seed?: number;
}
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}
/** Adds a tone of `freq` from `t0` for `dur` seconds into `out`. */
export function addTone(out: Float32Array, freq: number, t0: number, dur: number, o: ToneOpts) {
  const sr = o.sampleRate;
  const rnd = rng(o.seed ?? Math.round(freq * 1000));
  const vibC = o.vibratoCents ?? 0;
  const vibHz = o.vibratoHz ?? 5.5;
  const noise = o.noise ?? 0.01;
  const g = o.gain ?? 0.25;
  const start = Math.round(t0 * sr);
  const n = Math.round(dur * sr);
  const harmonics = Array.from({ length: 12 }, (_, i) => (i === 0 ? (o.fundamental ?? 1) : 1 / (i + 1)) * (i % 2 === 1 ? 0.8 : 1));
  let phase = 0;
  const att = Math.min(0.04 * sr, n / 3);
  const rel = Math.min(0.05 * sr, n / 3);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const vib = vibC ? 2 ** ((vibC * Math.sin(2 * Math.PI * vibHz * t)) / 1200) : 1;
    phase += (2 * Math.PI * freq * vib) / sr;
    let s = 0;
    for (let h = 0; h < harmonics.length; h++) {
      if (freq * (h + 1) > sr / 2.2) break;
      s += harmonics[h] * Math.sin((h + 1) * phase);
    }
    const env = Math.min(1, i / att, (n - i) / rel);
    const k = start + i;
    if (k >= 0 && k < out.length) out[k] += g * env * (0.3 * s + noise * rnd());
  }
}
export const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
