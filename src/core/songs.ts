import { STRING_MIDI, suggestFingering, type StringName } from "./music.ts";

export interface NoteEv {
  /** MIDI pitch, or null for a rest. */
  midi: number | null;
  /** start in beats from song start */
  start: number;
  /** duration in beats */
  dur: number;
  bar: number;
  string?: StringName;
  finger?: 0 | 1 | 2 | 3 | 4;
}
export interface Song {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  level: 1 | 2 | 3 | 4 | 5;
  bpm: number;
  beatsPerBar: number;
  /** Key signature in sharps (D major 2, A major 3, E minor 1). */
  sharps: number;
  keyName: string;
  /** one entry per bar; two chord names separated by a space split the bar in halves */
  chords: string[];
  notes: NoteEv[];
  note?: string;
}

const NAME_TO_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, H: 11, B: 11 };
/** Parse a tiny melody language: "D4:1 E4:1 F#4:2 r:1 | ..." (bars separated by |, duration in beats). */
function parse(src: string, beatsPerBar: number, id: string): NoteEv[] {
  const out: NoteEv[] = [];
  let t = 0;
  const bars = src.split("|").map((b) => b.trim()).filter(Boolean);
  bars.forEach((bar, bi) => {
    let inBar = 0;
    for (const tok of bar.split(/\s+/)) {
      const [p, d] = tok.split(":");
      const dur = Number(d);
      if (!(dur > 0)) throw new Error(`${id}: bad duration in ${tok}`);
      let midi: number | null = null;
      if (p !== "r") {
        const m = /^([A-H])(#|b)?(\d)$/.exec(p);
        if (!m) throw new Error(`${id}: bad pitch ${tok}`);
        midi = (Number(m[3]) + 1) * 12 + NAME_TO_PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
      }
      const ev: NoteEv = { midi, start: t, dur, bar: bi };
      if (midi !== null) {
        const f = suggestFingering(midi);
        if (!f) throw new Error(`${id}: ${tok} not playable in first position`);
        ev.string = f.string;
        ev.finger = f.finger;
      }
      out.push(ev);
      t += dur;
      inBar += dur;
    }
    if (Math.abs(inBar - beatsPerBar) > 1e-9) throw new Error(`${id}: bar ${bi + 1} has ${inBar} beats`);
  });
  return out;
}

function song(s: Omit<Song, "notes"> & { melody: string }): Song {
  const { melody, ...rest } = s;
  const notes = parse(melody, s.beatsPerBar, s.id);
  if (rest.chords.length !== notes[notes.length - 1].bar + 1) throw new Error(`${s.id}: chords per bar mismatch`);
  return { ...rest, notes };
}

export const SONGS: Song[] = [
  song({
    id: "entchen",
    title: "Alle meine Entchen",
    subtitle: "D-Dur · nur D- und A-Saite",
    emoji: "🦆",
    level: 1,
    bpm: 80,
    beatsPerBar: 4,
    sharps: 2,
    keyName: "D-Dur",
    chords: ["D", "D", "G", "D", "G", "D", "G", "D", "A", "D"],
    melody:
      "D4:1 E4:1 F#4:1 G4:1 | A4:2 A4:2 | B4:1 B4:1 B4:1 B4:1 | A4:4 | B4:1 B4:1 B4:1 B4:1 | A4:4 | G4:1 G4:1 G4:1 G4:1 | F#4:2 F#4:2 | E4:1 E4:1 E4:1 E4:1 | D4:4",
  }),
  song({
    id: "haenschen",
    title: "Hänschen klein",
    subtitle: "D-Dur · D- und A-Saite",
    emoji: "🎒",
    level: 2,
    bpm: 84,
    beatsPerBar: 4,
    sharps: 2,
    keyName: "D-Dur",
    chords: ["D", "A", "D", "D", "D", "A", "D", "D", "A", "A", "D", "D", "D", "A", "D", "D"],
    melody:
      "A4:1 F#4:1 F#4:2 | G4:1 E4:1 E4:2 | D4:1 E4:1 F#4:1 G4:1 | A4:1 A4:1 A4:2 | A4:1 F#4:1 F#4:2 | G4:1 E4:1 E4:2 | D4:1 F#4:1 A4:1 A4:1 | D4:4 | " +
      "E4:1 E4:1 E4:1 E4:1 | E4:1 F#4:1 G4:2 | F#4:1 F#4:1 F#4:1 F#4:1 | F#4:1 G4:1 A4:2 | A4:1 F#4:1 F#4:2 | G4:1 E4:1 E4:2 | D4:1 F#4:1 A4:1 A4:1 | D4:4",
  }),
  song({
    id: "ode",
    title: "Ode an die Freude",
    subtitle: "Beethoven · D-Dur · mit Achteln",
    emoji: "🎉",
    level: 3,
    bpm: 80,
    beatsPerBar: 4,
    sharps: 2,
    keyName: "D-Dur",
    chords: ["D", "D A", "D", "A", "D", "D A", "D", "A D", "A D", "A D", "A", "D A", "D", "D A", "D", "A D"],
    melody:
      "F#4:1 F#4:1 G4:1 A4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 D4:1 E4:1 F#4:1 | F#4:1.5 E4:0.5 E4:2 | " +
      "F#4:1 F#4:1 G4:1 A4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 D4:1 E4:1 F#4:1 | E4:1.5 D4:0.5 D4:2 | " +
      "E4:1 E4:1 F#4:1 D4:1 | E4:1 F#4:0.5 G4:0.5 F#4:1 D4:1 | E4:1 F#4:0.5 G4:0.5 F#4:1 E4:1 | D4:1 E4:1 A3:2 | " +
      "F#4:1 F#4:1 G4:1 A4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 D4:1 E4:1 F#4:1 | E4:1.5 D4:0.5 D4:2",
  }),
  song({
    id: "twinkle",
    title: "Twinkle Twinkle Little Star",
    subtitle: "A-Dur · A- und E-Saite",
    emoji: "⭐",
    level: 4,
    bpm: 80,
    beatsPerBar: 4,
    sharps: 3,
    keyName: "A-Dur",
    chords: ["A", "D A", "D A", "E A", "A D", "A E", "A D", "A E", "A", "D A", "D A", "E A"],
    melody:
      "A4:1 A4:1 E5:1 E5:1 | F#5:1 F#5:1 E5:2 | D5:1 D5:1 C#5:1 C#5:1 | B4:1 B4:1 A4:2 | " +
      "E5:1 E5:1 D5:1 D5:1 | C#5:1 C#5:1 B4:2 | E5:1 E5:1 D5:1 D5:1 | C#5:1 C#5:1 B4:2 | " +
      "A4:1 A4:1 E5:1 E5:1 | F#5:1 F#5:1 E5:2 | D5:1 D5:1 C#5:1 C#5:1 | B4:1 B4:1 A4:2",
  }),
  song({
    id: "hedwig",
    title: "Harry-Potter-Thema",
    subtitle: "Zauber-Walzer · e-Moll · vereinfacht",
    emoji: "🪄",
    level: 5,
    bpm: 96,
    beatsPerBar: 3,
    sharps: 1,
    keyName: "e-Moll",
    note: "Eigene, stark vereinfachte Anfänger-Bearbeitung der Anfangsmelodie (Hedwig's Theme, John Williams). Nur für den privaten Gebrauch.",
    chords: ["Em", "Em", "Em", "Am", "B7", "Em", "B7", "B", "Em", "Em", "A", "G", "Em", "B7", "B7", "Em"],
    melody:
      "r:2 B3:1 | E4:1.5 G4:0.5 F#4:1 | E4:1 B4:2 | A4:3 | F#4:3 | E4:1.5 G4:0.5 F#4:1 | D4:1 F#4:2 | B3:2 B3:1 | " +
      "E4:1.5 G4:0.5 F#4:1 | E4:1 B4:2 | D5:1 C#5:2 | B4:1 G4:2 | B4:1.5 A4:0.5 G4:1 | F#4:1.5 G4:0.5 F#4:1 | D4:1 F#4:2 | E4:3",
  }),
];

export const songById = (id: string) => SONGS.find((s) => s.id === id);
export const playable = (s: Song) => s.notes.filter((n) => n.midi !== null);
export const songBeats = (s: Song) => s.chords.length * s.beatsPerBar;
export const openMidi = (s: StringName) => STRING_MIDI[s];

/** Chord at a beat position, from the per-bar chord list. */
export function chordAt(s: Song, beat: number): string {
  const bar = Math.max(0, Math.min(s.chords.length - 1, Math.floor(beat / s.beatsPerBar)));
  const parts = s.chords[bar].split(" ");
  if (parts.length === 1) return parts[0];
  const inBar = beat - bar * s.beatsPerBar;
  return parts[Math.min(parts.length - 1, Math.floor((inBar / s.beatsPerBar) * parts.length))];
}

const ROOT_PC: Record<string, number> = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, B: 11, H: 11 };
/** Chord symbol -> pitch classes (root first). Supports major, m, 7. */
export function chordTones(sym: string): number[] {
  const m = /^([A-H]#?)(m)?(7)?$/.exec(sym);
  if (!m) throw new Error(`bad chord ${sym}`);
  const r = ROOT_PC[m[1]];
  const t = [r, (r + (m[2] ? 3 : 4)) % 12, (r + 7) % 12];
  if (m[3]) t.push((r + 10) % 12);
  return t;
}
