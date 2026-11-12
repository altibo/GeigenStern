// Scrolling score strip: treble staff and/or four string lanes, aligned on one time axis.
import { GLYPHS } from "./glyphs.ts";
import { staffStep, type StringName } from "../core/music.ts";
import type { NoteEv, Song } from "../core/songs.ts";

export type ViewMode = "tabs" | "both" | "notes";
export const STRING_COLORS: Record<StringName, { fill: string; ink: string }> = {
  G: { fill: "#a8e6c8", ink: "#2f7a59" },
  D: { fill: "#a9d6ff", ink: "#2c6aa3" },
  A: { fill: "#d4c2ff", ink: "#6249b3" },
  E: { fill: "#ffc0cf", ink: "#b2456a" },
};
const LANES: StringName[] = ["E", "A", "D", "G"];
const NS = "http://www.w3.org/2000/svg";

function el(tag: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const e = document.createElementNS(NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}
function glyph(name: keyof typeof GLYPHS, x: number, y: number, k: number, parent: Element, cls = "ink") {
  return el("path", { d: GLYPHS[name].d, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k} ${-k})`, class: cls }, parent);
}

// sharps in key-signature order with treble staff steps (E4 = 0)
const KEY_SHARPS: { letter: number; step: number }[] = [
  { letter: 3, step: 8 }, // F5
  { letter: 0, step: 5 }, // C5
  { letter: 4, step: 9 }, // G5
  { letter: 1, step: 6 }, // D5
  { letter: 5, step: 3 }, // A4
];
const letterOfStep = (step: number) => (((step + 2) % 7) + 7) % 7; // 0=C ... E4 step0 -> letter 2

export interface Layout {
  width: number;
  height: number;
  ppb: number;
  hitX: number;
  leftPanel: number;
}

export class Strip {
  svg: SVGSVGElement;
  private scroll!: SVGGElement;
  private noteEls = new Map<number, SVGElement[]>();
  private pitchMarker: SVGElement | null = null;
  layout!: Layout;
  private staffBottom = 0;
  private gap = 10;
  private laneTop = 0;
  private laneH = 0;
  mode: ViewMode = "tabs";
  song: Song;
  constructor(song: Song) {
    this.song = song;
    this.svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    this.svg.classList.add("strip");
    this.svg.setAttribute("data-testid", "strip");
  }

  build(width: number, height: number, mode: ViewMode) {
    this.mode = mode;
    this.svg.innerHTML = "";
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svg.setAttribute("width", String(width));
    this.svg.setAttribute("height", String(height));
    this.svg.dataset.mode = mode;
    this.noteEls.clear();
    const s = this.song;
    const hasStaff = mode !== "tabs";
    const hasLanes = mode !== "notes";
    // vertical split
    let staffH = 0;
    if (hasStaff && hasLanes) staffH = height * 0.46;
    else if (hasStaff) staffH = height;
    this.gap = hasStaff ? Math.max(7, Math.min(mode === "notes" ? 22 : 18, staffH / (mode === "notes" ? 9.5 : 10), width / 20)) : 10;
    const g = this.gap;
    this.staffBottom = staffH / 2 + 2 * g + (mode === "notes" ? g * 0.4 : g * 0.6);
    this.laneTop = staffH + (hasStaff ? 4 : 8);
    this.laneH = hasLanes ? (height - this.laneTop - 8) / 4 : 0;
    const leftPanel = hasStaff ? Math.max(5.2 * g + s.sharps * 1.1 * g, hasLanes ? 56 : 0) : 56;
    const ppb = Math.max(92, Math.min(150, width * 0.16));
    const hitX = leftPanel + Math.max(40, width * 0.14);
    this.layout = { width, height, ppb, hitX, leftPanel };

    const defs = el("defs", {}, this.svg);
    const clip = el("clipPath", { id: "scrollclip" }, defs);
    el("rect", { x: leftPanel, y: 0, width: width - leftPanel, height }, clip);

    // backgrounds
    if (hasLanes)
      LANES.forEach((name, i) => {
        const y = this.laneTop + i * this.laneH;
        el("rect", { x: 0, y: y + 2, width, height: this.laneH - 4, rx: 12, class: `lane lane-${name}`, fill: STRING_COLORS[name].fill, "fill-opacity": 0.28 }, this.svg);
      });
    if (hasStaff)
      for (let l = 0; l < 5; l++) el("line", { x1: 4, x2: width - 4, y1: this.yStep(l * 2), y2: this.yStep(l * 2), class: "staffline" }, this.svg);

    const clipG = el("g", { "clip-path": "url(#scrollclip)" }, this.svg);
    this.scroll = el("g", { class: "scroll" }, clipG) as SVGGElement;
    const total = s.chords.length * s.beatsPerBar;
    // bar lines + beat ticks
    for (let b = 0; b <= total; b += 1) {
      const x = b * ppb;
      const isBar = b % s.beatsPerBar === 0;
      if (hasStaff && isBar) el("line", { x1: x - ppb * 0.12, x2: x - ppb * 0.12, y1: this.yStep(8), y2: this.yStep(0), class: b === total ? "barline end" : "barline" }, this.scroll);
      if (hasLanes) el("line", { x1: x, x2: x, y1: this.laneTop + 4, y2: this.laneTop + 4 * this.laneH - 4, class: isBar ? "lanebar" : "lanetick" }, this.scroll);
      if (isBar && b < total) {
        const ty = hasStaff ? this.yStep(8) - g * 1.6 : this.laneTop - 1;
        if (hasStaff || this.laneTop > 14) el("text", { x: x + 4, y: Math.max(12, ty), class: "barnum" }, this.scroll).textContent = String(b / s.beatsPerBar + 1);
      }
    }
    for (let i = 0; i < s.notes.length; i++) {
      const n = s.notes[i];
      const parts: SVGElement[] = [];
      const grp = el("g", { class: n.midi === null ? "ev rest" : "ev note", "data-i": i }, this.scroll);
      if (hasStaff) this.drawStaffNote(n, grp);
      if (hasLanes && n.midi !== null) this.drawLaneNote(n, grp);
      parts.push(grp);
      this.noteEls.set(i, parts);
    }

    // fixed left panel: clef, key signature, string labels
    const panel = el("g", { class: "panel" }, this.svg);
    el("rect", { x: 0, y: 0, width: leftPanel, height, class: "panel-bg" }, panel);
    if (hasStaff) {
      for (let l = 0; l < 5; l++) el("line", { x1: 4, x2: leftPanel, y1: this.yStep(l * 2), y2: this.yStep(l * 2), class: "staffline" }, panel);
      const k = g / 250;
      glyph("gClef", g * 0.5, this.yStep(2), k, panel);
      KEY_SHARPS.slice(0, s.sharps).forEach((ks, i) => glyph("sharp", g * 3.4 + i * g * 1.05, this.yStep(ks.step), k, panel));
    }
    if (hasLanes)
      LANES.forEach((name, i) => {
        const y = this.laneTop + i * this.laneH + this.laneH / 2;
        el("circle", { cx: 26, cy: y, r: Math.min(20, this.laneH * 0.42), fill: STRING_COLORS[name].fill, stroke: STRING_COLORS[name].ink, "stroke-width": 2 }, panel);
        const t = el("text", { x: 26, y: y + 1, class: "lane-label", fill: STRING_COLORS[name].ink, "font-size": Math.min(22, this.laneH * 0.5) }, panel);
        t.textContent = name;
      });
    // hit line (the "now" cursor)
    const top = hasStaff ? this.yStep(10) - g : this.laneTop;
    const bottom = hasLanes ? this.laneTop + 4 * this.laneH : this.yStep(-2) + g;
    el("rect", { x: hitX - 3, y: top, width: 6, height: bottom - top, rx: 3, class: "hitline", "data-testid": "hitline" }, this.svg);
    this.pitchMarker = el("circle", { cx: hitX, cy: -100, r: hasStaff ? g * 0.45 : 7, class: "pitch-marker" }, this.svg);
  }

  private yStep(step: number) {
    return this.staffBottom - (step * this.gap) / 2;
  }

  private drawStaffNote(n: NoteEv, grp: Element) {
    const g = this.gap;
    const k = g / 250;
    const x = n.start * this.layout.ppb;
    const durName = n.dur >= 4 ? "whole" : n.dur >= 2 ? "half" : n.dur >= 1 ? "quarter" : "eighth";
    const dotted = [0.75, 1.5, 3].includes(n.dur);
    if (n.midi === null) {
      const y = this.yStep(4);
      if (n.dur >= 4) glyph("restWhole", x, this.yStep(6), k, grp);
      else if (n.dur >= 2) glyph("restHalf", x, y, k, grp);
      else if (n.dur >= 1) glyph("restQuarter", x, y, k, grp);
      else glyph("restEighth", x, y, k, grp);
      return;
    }
    const { step, sharp } = staffStep(n.midi);
    const y = this.yStep(step);
    // ledger lines
    for (let l = -2; l >= step; l -= 2) el("line", { x1: x - g * 0.45, x2: x + g * 1.6, y1: this.yStep(l), y2: this.yStep(l), class: "ledger" }, grp);
    for (let l = 10; l <= step; l += 2) el("line", { x1: x - g * 0.45, x2: x + g * 1.6, y1: this.yStep(l), y2: this.yStep(l), class: "ledger" }, grp);
    // accidental if not covered by the key
    const letter = letterOfStep(step);
    const inKey = KEY_SHARPS.slice(0, this.song.sharps).some((s) => s.letter === letter);
    if (sharp && !inKey) glyph("sharp", x - g * 1.3, y, k, grp);
    if (!sharp && inKey) glyph("natural", x - g * 1.1, y, k, grp);
    const head = durName === "whole" ? "noteheadWhole" : durName === "half" ? "noteheadHalf" : "noteheadBlack";
    glyph(head, x, y, k, grp, "ink head");
    const w = (GLYPHS[head].w as number) * k;
    if (dotted) el("circle", { cx: x + w + g * 0.4, cy: step % 2 === 0 ? y - g / 2 : y, r: g * 0.16, class: "inkfill" }, grp);
    if (durName !== "whole") {
      const up = step < 4;
      const sx = up ? x + w - g * 0.06 : x + g * 0.06;
      const sy2 = up ? y - g * 3.4 : y + g * 3.4;
      el("line", { x1: sx, x2: sx, y1: y + (up ? -g * 0.15 : g * 0.15), y2: sy2, class: "stem" }, grp);
      if (durName === "eighth") glyph(up ? "flag8thUp" : "flag8thDown", sx - g * 0.06, sy2, k, grp);
    }
  }

  private drawLaneNote(n: NoteEv, grp: Element) {
    const ppb = this.layout.ppb;
    const li = LANES.indexOf(n.string!);
    const y = this.laneTop + li * this.laneH;
    const x = n.start * ppb;
    const w = Math.max(18, n.dur * ppb - 6);
    const c = STRING_COLORS[n.string!];
    const h = Math.min(this.laneH * 0.72, 46);
    el("rect", { x, y: y + (this.laneH - h) / 2, width: w, height: h, rx: h / 2, fill: c.fill, stroke: c.ink, "stroke-width": 2, class: "tabnote" }, grp);
    const r = Math.min(h / 2 - 1, 17);
    el("circle", { cx: x + r + 1, cy: y + this.laneH / 2, r, fill: "#fff", stroke: c.ink, "stroke-width": 2.5, class: "bubble" }, grp);
    const t = el("text", { x: x + r + 1, y: y + this.laneH / 2 + 1, class: "finger", fill: c.ink, "font-size": Math.min(22, r * 1.25) }, grp);
    t.textContent = String(n.finger);
  }

  /** scroll so that `beat` sits on the hit line */
  setBeat(beat: number) {
    const x = this.layout.hitX - beat * this.layout.ppb;
    this.scroll.setAttribute("transform", `translate(${x.toFixed(1)} 0)`);
  }
  mark(i: number, cls: string) {
    for (const e of this.noteEls.get(i) ?? []) e.classList.add(cls);
  }
  clearMarks() {
    for (const parts of this.noteEls.values()) for (const e of parts) e.classList.remove("hit-good", "hit-ok", "hit-bad", "current");
  }
  /** show the detected pitch at the hit line (staff: by step, lanes: hidden) */
  showPitch(midi: number | null, good: boolean) {
    if (!this.pitchMarker) return;
    if (midi === null) {
      this.pitchMarker.setAttribute("cy", "-100");
      return;
    }
    let y: number;
    if (this.mode !== "tabs") y = this.yStep(staffStep(Math.round(midi)).step);
    else {
      const lane = midi >= 76 ? 0 : midi >= 69 ? 1 : midi >= 62 ? 2 : 3;
      y = this.laneTop + lane * this.laneH + this.laneH / 2;
    }
    this.pitchMarker.setAttribute("cy", y.toFixed(1));
    this.pitchMarker.classList.toggle("good", good);
  }
}
