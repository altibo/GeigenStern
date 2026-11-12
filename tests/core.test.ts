import { test } from "node:test";
import assert from "node:assert/strict";
import { Yin } from "../src/core/pitch.ts";
import { a4FromMeasurement, centsOff, clampA4, firstPositionFinger, freqToMidi, getA4, midiToFreq, noteName, setA4, staffStep, STRING_MIDI } from "../src/core/music.ts";
import { SONGS, chordAt, chordTones, playable, songBeats } from "../src/core/songs.ts";
import { BeatClock, SPEEDS, clampTempoPct, effectiveBpm, secPerBeat } from "../src/core/speed.ts";
import { Judge, STAR_THRESHOLDS, starsFor, summarise, worstPassage, type Frame } from "../src/core/judge.ts";
import { applyRun, defaultProgress, streak, dayKey } from "../src/core/progress.ts";
import { addTone, midiHz } from "../tools/violin-synth.ts";

const SR = 48000;
const FRAME = 1024;

function detectMedian(freq: number, opts: Partial<Parameters<typeof addTone>[4]> = {}) {
  const buf = new Float32Array(SR);
  addTone(buf, freq, 0, 1, { sampleRate: SR, ...opts });
  const yin = new Yin(SR, FRAME);
  const cents: number[] = [];
  for (let i = 4800; i + FRAME < 44000; i += 480) {
    const r = yin.detect(buf.subarray(i, i + FRAME));
    if (r.freq > 0 && r.clarity > 0.8) cents.push(centsOff(r.freq, freqToMidi(freq)));
  }
  cents.sort((a, b) => a - b);
  return { median: cents[cents.length >> 1], hits: cents.length, worst: Math.max(Math.abs(cents[0]), Math.abs(cents[cents.length - 1])) };
}

test("YIN finds every first-position violin note (G3..B5) within 5 cents", () => {
  for (let m = 55; m <= 83; m++) {
    const r = detectMedian(midiHz(m));
    assert.ok(r.hits > 70, `${noteName(m)} hits ${r.hits}`);
    assert.ok(Math.abs(r.median) < 5, `${noteName(m)} median ${r.median}`);
    assert.ok(r.worst < 15, `${noteName(m)} worst ${r.worst}`);
  }
});

test("YIN: weak fundamental (G string) gives no octave error", () => {
  for (const m of [55, 57, 59, 60]) {
    const r = detectMedian(midiHz(m), { fundamental: 0.25 });
    assert.ok(Math.abs(r.median) < 8, `${noteName(m)} median ${r.median}`);
  }
});

test("YIN: vibrato ±25 cents and bow noise -> median on the note", () => {
  for (const m of [62, 69, 76, 81]) {
    const r = detectMedian(midiHz(m), { vibratoCents: 25, vibratoHz: 5.5, noise: 0.05 });
    assert.ok(Math.abs(r.median) < 10, `${noteName(m)} median ${r.median}`);
    assert.ok(r.worst < 45, `${noteName(m)} worst ${r.worst}`);
  }
});

test("YIN: detuned notes are measured (for 'zu hoch / zu tief')", () => {
  for (const off of [-40, -20, 20, 40]) {
    const f = midiHz(69) * 2 ** (off / 1200);
    const r = detectMedian(f);
    // median relative to the detuned frequency itself must be ~0 -> relative to A4 it equals off
    assert.ok(Math.abs(r.median) < 4, `off ${off}: ${r.median}`);
  }
});

test("YIN: silence and white noise give no pitch", () => {
  const yin = new Yin(SR, FRAME);
  assert.equal(yin.detect(new Float32Array(FRAME)).freq, 0);
  const n = new Float32Array(FRAME);
  let s = 7;
  for (let i = 0; i < FRAME; i++) {
    s = (s * 16807) % 2147483647;
    n[i] = (s / 2147483647 - 0.5) * 0.3;
  }
  const r = yin.detect(n);
  assert.ok(r.freq === 0 || r.clarity < 0.8);
});

test("music helpers", () => {
  assert.equal(Math.round(midiToFreq(55) * 100) / 100, 196);
  assert.equal(noteName(71), "H4");
  assert.equal(noteName(66), "F♯4");
  assert.equal(staffStep(64).step, 0); // E4 bottom line
  assert.equal(staffStep(77).step, 8); // F5 top line
  assert.deepEqual(staffStep(66), { step: 1, sharp: true });
  assert.equal(staffStep(57).step, -4); // A3 two ledger lines
  assert.equal(firstPositionFinger(59, "G"), 2);
  assert.equal(firstPositionFinger(73, "A"), 2);
  assert.equal(firstPositionFinger(74, "A"), 3);
  assert.equal(firstPositionFinger(84, "E"), null);
});

test("songs: five songs easy->hard, bars complete, every note playable in first position with correct string/finger", () => {
  assert.deepEqual(
    SONGS.map((s) => s.id),
    ["entchen", "haenschen", "ode", "twinkle", "hedwig"],
  );
  assert.deepEqual(
    SONGS.map((s) => s.level),
    [1, 2, 3, 4, 5],
  );
  const semis: Record<number, number[]> = { 0: [0], 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7] };
  for (const s of SONGS) {
    assert.equal(songBeats(s), s.notes[s.notes.length - 1].start + s.notes[s.notes.length - 1].dur, s.id);
    for (const n of playable(s)) {
      assert.ok(n.string && n.finger !== undefined, `${s.id} ${n.midi}`);
      const d = n.midi! - STRING_MIDI[n.string!];
      assert.ok(semis[n.finger!].includes(d), `${s.id} ${noteName(n.midi!)} on ${n.string} finger ${n.finger}`);
      assert.ok(n.midi! >= 55 && n.midi! <= 83, `${s.id} range`);
    }
    for (let b = 0; b < songBeats(s); b += 0.5) chordTones(chordAt(s, b));
  }
  const hed = SONGS.find((s) => s.id === "hedwig")!;
  assert.equal(hed.chords.length, 16);
  assert.ok(hed.note?.includes("privat"));
  // spot checks of the classic beginner fingerings
  const ent = SONGS[0].notes;
  assert.deepEqual(
    ent.slice(0, 5).map((n) => `${n.string}${n.finger}`),
    ["D0", "D1", "D2", "D3", "A0"],
  );
  const tw = playable(SONGS[3]);
  assert.deepEqual(
    tw.slice(0, 6).map((n) => `${n.string}${n.finger}`),
    ["A0", "A0", "E0", "E0", "E1", "E1"],
  );
});

test("speed scaling and wait flags", () => {
  assert.equal(effectiveBpm(100, SPEEDS.normal), 100);
  assert.equal(effectiveBpm(100, SPEEDS.turtle), 70);
  assert.equal(effectiveBpm(100, SPEEDS.snail), 50);
  assert.equal(secPerBeat(120, SPEEDS.snail), 1);
  assert.equal(SPEEDS.normal.wait, false);
  assert.ok(SPEEDS.turtle.wait && SPEEDS.snail.wait);
  assert.ok(SPEEDS.snail.tol > SPEEDS.turtle.tol && SPEEDS.turtle.tol > SPEEDS.normal.tol);
  const c = new BeatClock(0.5);
  c.start(10, -4);
  assert.equal(c.beatAt(10), -4);
  assert.equal(c.beatAt(12), 0);
  c.freeze(3);
  assert.equal(c.beatAt(100), 3);
  c.resume(100);
  assert.equal(c.beatAt(100.5), 4);
});

/** frames for an ideal performance: correct pitch with a 30 ms gap + onset at every note start */
function perform(notes: ReturnType<typeof playable>, spb: number, opts: { cents?: number; lateMs?: number; skip?: Set<number>; wrong?: Set<number> } = {}) {
  const frames: Frame[] = [];
  const hop = 0.02 / spb; // beats per 20 ms frame
  const end = notes[notes.length - 1].start + notes[notes.length - 1].dur + 1;
  for (let b = -1; b < end; b += hop) {
    const late = (opts.lateMs ?? 0) / 1000 / spb;
    const i = notes.findIndex((n) => b >= n.start + late && b < n.start + n.dur + late - 0.03 / spb);
    if (i < 0 || opts.skip?.has(i)) {
      frames.push({ beat: b, freq: 0, clarity: 0, rms: 0.001, onset: false });
      continue;
    }
    const n = notes[i];
    const midi = n.midi! + (opts.wrong?.has(i) ? 3 : 0);
    const onset = b - (n.start + late) < hop;
    frames.push({ beat: b, freq: midiToFreq(midi) * 2 ** ((opts.cents ?? 0) / 1200), clarity: 0.95, rms: 0.05, onset });
  }
  return frames;
}

test("judge (normal): perfect play -> 3 stars, all Super, combo grows", () => {
  const s = SONGS[0];
  const notes = playable(s);
  const spb = secPerBeat(s.bpm, SPEEDS.normal);
  const j = new Judge(notes, SPEEDS.normal, spb);
  for (const f of perform(notes, spb)) j.push(f);
  j.flush();
  const sum = summarise(j.results, j.maxCombo);
  assert.equal(sum.notes, notes.length);
  assert.ok(j.results.every((r) => r.pitch === "super" && r.time === "ok"), JSON.stringify(j.results.find((r) => r.pitch !== "super" || r.time !== "ok")));
  assert.equal(sum.stars, 3);
  assert.equal(j.maxCombo, notes.length);
  assert.ok(sum.score > sum.base);
});

test("judge (normal): sharp, flat, late, missed and wrong notes", () => {
  const s = SONGS[1];
  const notes = playable(s);
  const spb = secPerBeat(s.bpm, SPEEDS.normal);
  const run = (o: Parameters<typeof perform>[2]) => {
    const j = new Judge(notes, SPEEDS.normal, spb);
    for (const f of perform(notes, spb, o)) j.push(f);
    j.flush();
    return j;
  };
  assert.ok(run({ cents: 55 }).results.every((r) => r.pitch === "hoch"));
  assert.ok(run({ cents: -55 }).results.every((r) => r.pitch === "tief"));
  const late = run({ lateMs: 220 });
  assert.ok(late.results.filter((r) => r.time === "spaet").length > notes.length * 0.9);
  const skip = run({ skip: new Set([0, 1, 2]) });
  assert.deepEqual(
    skip.results.slice(0, 3).map((r) => r.pitch),
    ["verpasst", "verpasst", "verpasst"],
  );
  const wrong = run({ wrong: new Set(notes.map((_, i) => i)) });
  const sum = summarise(wrong.results, wrong.maxCombo);
  assert.ok(wrong.results.every((r) => r.pitch === "viel-hoch"));
  assert.equal(sum.stars, 0);
});

test("judge (wait mode): holds at note start until the correct, fresh note arrives", () => {
  const s = SONGS[0];
  const notes = playable(s).slice(0, 6);
  const sp = SPEEDS.snail;
  const spb = secPerBeat(s.bpm, sp);
  const j = new Judge(notes, sp, spb);
  const fr = (beat: number, midi: number | null, onset = false): Frame => ({ beat, freq: midi === null ? 0 : midiToFreq(midi), clarity: 0.95, rms: 0.05, onset });
  // on time there is a short grace; silence after it -> must hold
  assert.ok(!j.shouldHoldAt(0));
  assert.ok(j.graceBeats > 0 && j.graceBeats <= 0.35);
  assert.ok(j.shouldHoldAt(j.holdBeat()));
  for (let i = 0; i < 10; i++) j.push(fr(0, null));
  assert.equal(j.index, 0);
  // wrong note (E4 instead of D4) for a while -> still waiting, hint "hoch"
  for (let i = 0; i < 6; i++) j.push(fr(0, 64));
  assert.equal(j.index, 0);
  assert.equal(j.liveHint, "viel-hoch");
  // right note -> released with an attempt penalty
  let got: ReturnType<Judge["push"]> = [];
  for (let i = 0; i < 4; i++) got = got.concat(j.push(fr(0, 62)));
  assert.equal(got.length, 1);
  assert.equal(got[0].pitch, "super");
  assert.equal(got[0].attempts, 1);
  assert.ok(got[0].points < 100 && got[0].points >= 70);
  // next notes: E4 F#4 G4 A4 A4 -- the second A4 needs a new bow stroke
  for (const [b, m] of [
    [1, 64],
    [2, 66],
    [3, 67],
    [4, 69],
  ] as const)
    for (let i = 0; i < 4; i++) j.push(fr(b, m, i === 0));
  assert.equal(j.index, 5);
  for (let i = 0; i < 8; i++) j.push(fr(6, 69));
  assert.equal(j.index, 5, "held A4 without a new stroke must not count for the repeated A4");
  for (let i = 0; i < 4; i++) j.push(fr(6, 69, i === 0));
  assert.ok(j.done);
  assert.ok(j.results.slice(1).every((r) => r.points === 100));
});

test("stars thresholds", () => {
  assert.deepEqual([...STAR_THRESHOLDS], [0.5, 0.7, 0.88]);
  assert.equal(starsFor(0.49), 0);
  assert.equal(starsFor(0.5), 1);
  assert.equal(starsFor(0.7), 2);
  assert.equal(starsFor(0.879), 2);
  assert.equal(starsFor(0.88), 3);
});

test("worst passage suggestion", () => {
  const m = new Map([
    [0, 1],
    [1, 0.9],
    [2, 0.3],
    [3, 0.4],
    [4, 1],
  ]);
  assert.deepEqual(worstPassage(m, 5), { from: 2, to: 3, accuracy: 0.35 });
});

test("progress: best score, stars kept, streak and badges", () => {
  const p = defaultProgress();
  assert.equal(p.name, "Liviana");
  const ids = SONGS.map((s) => s.id);
  const d = (s: string) => new Date(`${s}T18:00:00`);
  let r = applyRun(p, { songId: "entchen", score: 900, stars: 2, perfect: 60, speed: "turtle" }, ids, d("2026-11-10"));
  assert.deepEqual(r.newBadges, ["first"]);
  r = applyRun(p, { songId: "entchen", score: 500, stars: 1, perfect: 50, speed: "snail" }, ids, d("2026-11-11"));
  assert.equal(p.songs.entchen.stars, 2);
  assert.equal(p.songs.entchen.best, 900);
  assert.ok(r.newBadges.includes("perfect100"));
  r = applyRun(p, { songId: "ode", score: 1500, stars: 3, perfect: 10, speed: "normal" }, ids, d("2026-11-12"));
  assert.ok(r.newBadges.includes("three") && r.newBadges.includes("streak3") && r.newBadges.includes("normal"));
  assert.equal(streak(p.days, d("2026-11-12")), 3);
  assert.equal(streak(p.days, d("2026-11-13")), 3, "streak survives until the end of the next day");
  assert.equal(streak(p.days, d("2026-11-15")), 0);
  assert.equal(dayKey(d("2026-01-05")), "2026-01-05");
});

test("judge (wait mode): the previous note still ringing is not counted as a wrong attempt", () => {
  const s = SONGS[0];
  const notes = playable(s).slice(0, 3);
  const sp = SPEEDS.turtle;
  const j = new Judge(notes, sp, secPerBeat(s.bpm, sp));
  const fr = (beat: number, midi: number, onset = false): Frame => ({ beat, freq: midiToFreq(midi), clarity: 0.95, rms: 0.05, onset });
  for (let i = 0; i < 4; i++) j.push(fr(0.05, 62, i === 0));
  assert.equal(j.index, 1);
  // D4 keeps sounding into E4's window and past its start
  for (let i = 0; i < 10; i++) j.push(fr(0.9 + i * 0.03, 62));
  for (let i = 0; i < 4; i++) j.push(fr(1.25, 64));
  assert.equal(j.results[1].attempts, 0);
  assert.equal(j.results[1].points, 100);
});

test("Kammerton 432 Hz: detection, note mapping and scoring follow the reference", () => {
  try {
    assert.equal(setA4(432), 432);
    assert.equal(getA4(), 432);
    assert.equal(midiToFreq(69), 432);
    assert.ok(Math.abs(midiToFreq(55) - 192.43) < 0.01); // G string at 432
    const yin = new Yin(SR, FRAME);
    for (const m of [55, 62, 69, 76, 59, 73]) {
      const f = midiToFreq(m);
      const buf = new Float32Array(SR / 2);
      addTone(buf, f, 0, 0.5, { sampleRate: SR, vibratoCents: 15, noise: 0.03 });
      const r = yin.detect(buf.subarray(6000, 6000 + FRAME));
      assert.equal(Math.round(freqToMidi(r.freq)), m, noteName(m));
      assert.ok(Math.abs(centsOff(r.freq, m)) < 20, `${noteName(m)} ${centsOff(r.freq, m)}`);
    }
    // a whole song played at 432 is perfect when the reference is 432 ...
    const s = SONGS[3];
    const notes = playable(s);
    const spb = secPerBeat(s.bpm, SPEEDS.normal);
    const frames = perform(notes, spb);
    const j = new Judge(notes, SPEEDS.normal, spb);
    for (const f of frames) j.push(f);
    j.flush();
    assert.ok(j.results.every((r) => r.pitch === "super"));
    // ... but about 32 cents flat against 440
    setA4(440);
    const j2 = new Judge(notes, SPEEDS.normal, spb);
    for (const f of frames) j2.push(f);
    j2.flush();
    assert.ok(j2.results.every((r) => r.pitch === "tief"), j2.results.map((r) => r.pitch).join());
    assert.ok(Math.abs(j2.results[0].cents + 31.8) < 1);
  } finally {
    setA4(440);
  }
});

test("Kammerton range, presets and auto-detect from the open A string", () => {
  assert.equal(clampA4(400), 415);
  assert.equal(clampA4(500), 466);
  assert.equal(clampA4(431.6), 432);
  assert.equal(a4FromMeasurement([432.2, 431.9, 432.4, 432.1, 431.8, 600, 300]), 432);
  assert.equal(a4FromMeasurement([441.6, 441.7, 441.4, 441.5, 441.8]), 442);
  assert.equal(a4FromMeasurement([293, 294, 295, 296, 297]), null);
  assert.equal(a4FromMeasurement([432]), null);
});

test("beginner tempos and fine tempo", () => {
  for (const s of SONGS) assert.ok(s.bpm >= 72 && s.bpm <= 100, `${s.id} ${s.bpm}`);
  assert.deepEqual(
    SONGS.map((s) => s.bpm),
    [80, 84, 80, 80, 96],
  );
  assert.equal(effectiveBpm(80, SPEEDS.normal, 100), 80);
  assert.equal(effectiveBpm(80, SPEEDS.turtle, 100), 56);
  assert.equal(effectiveBpm(80, SPEEDS.snail, 100), 40);
  assert.equal(effectiveBpm(80, SPEEDS.normal, 75), 60);
  assert.equal(secPerBeat(80, SPEEDS.normal, 100), 0.75);
  assert.equal(clampTempoPct(40), 60);
  assert.equal(clampTempoPct(133), 120);
  assert.equal(clampTempoPct(87), 85);
});
