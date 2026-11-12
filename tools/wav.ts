import { addTone, midiHz } from "./violin-synth.ts";
import type { Song } from "../src/core/songs.ts";

export function encodeWav(data: Float32Array, sr: number): Buffer {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + data.length * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  return b;
}

/** Renders a song melody (beat 0 = t 0) as a violin-like WAV. `alter(i)` returns [semitones, cents] per playable note. */
export function renderMelody(song: Song, bpm: number, alter: (i: number) => [number, number] = () => [0, 0], sr = 48000): Buffer {
  const spb = 60 / bpm;
  const notes = song.notes.filter((n) => n.midi !== null);
  const end = notes[notes.length - 1].start + notes[notes.length - 1].dur;
  const out = new Float32Array(Math.ceil((end * spb + 0.5) * sr));
  notes.forEach((n, i) => {
    const [semi, cents] = alter(i);
    addTone(out, midiHz(n.midi! + semi) * 2 ** (cents / 1200), n.start * spb, n.dur * spb - 0.04, { sampleRate: sr, vibratoCents: 12, vibratoHz: 5.5, noise: 0.02, gain: 0.5 });
  });
  return encodeWav(out, sr);
}
