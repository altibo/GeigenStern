import { Audio, Backing, type MicFrame } from "./audio/engine.ts";
import { Judge, summarise, type Judgement, type PitchVerdict, type Summary } from "./core/judge.ts";
import { freqToMidi, centsOff, pitchClassName } from "./core/music.ts";
import { songBeats, type NoteEv, type Song } from "./core/songs.ts";
import { BeatClock, SPEEDS, clampTempoPct, effectiveBpm, secPerBeat, type SpeedId } from "./core/speed.ts";
import type { Progress } from "./core/progress.ts";
import { btn, h, segmented } from "./ui/dom.ts";
import { owlSvg, type Mood } from "./ui/owl.ts";
import { Strip, type ViewMode } from "./ui/strip.ts";

export type PlayState = "ready" | "countin" | "running" | "waiting" | "paused" | "done";
export interface PlayOutcome {
  kind: "song" | "practice" | "preview";
  summary: Summary;
  results: Judgement[];
  speed: SpeedId;
  range: { from: number; to: number } | null;
  passes?: number;
}

const PITCH_TEXT: Record<PitchVerdict, string> = {
  super: "Super!",
  hoch: "etwas zu hoch",
  tief: "etwas zu tief",
  "viel-hoch": "zu hoch – anderer Ton",
  "viel-tief": "zu tief – anderer Ton",
  verpasst: "verpasst",
};
const STRING_DE: Record<string, string> = { G: "G-Saite", D: "D-Saite", A: "A-Saite", E: "E-Saite" };
const FINGER_DE = ["leere Saite", "1. Finger", "2. Finger", "3. Finger", "4. Finger"];
export const noteHint = (n: NoteEv) => `${pitchClassName(n.midi!)} · ${STRING_DE[n.string!]} · ${FINGER_DE[n.finger!]}`;

/** One play screen: ready panel, count-in, play/wait loop, practice loops and preview. */
export class PlayScreen {
  root: HTMLElement;
  state: PlayState = "ready";
  private stage: HTMLElement;
  private strip: Strip;
  private judge: Judge | null = null;
  private clock: BeatClock;
  private backing: Backing | null = null;
  private timer = 0;
  private raf = 0;
  private kind: PlayOutcome["kind"] = "song";
  private range: { from: number; to: number } | null = null;
  private startBeat = 0;
  private endBeat = 0;
  private gateSamples: number[] = [];
  private marks: [number, string][] = [];
  private passes = 0;
  private goodPasses = 0;
  private wakeLock: { release(): Promise<void> } | null = null;
  private feedback: HTMLElement;
  private feedbackSub: HTMLElement;
  private scoreEl: HTMLElement;
  private comboEl: HTMLElement;
  private owlBox: HTMLElement;
  private owlSay: HTMLElement;
  private hintEl: HTMLElement;
  private countEl: HTMLElement;
  private progressEl: HTMLElement;
  private overlay: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private fbTimer = 0;
  private frozenAt = 0;
  private lastOwl = "";
  private practiceFrom = 0;
  private practiceTo = 1;
  last: Judgement | null = null;
  audio: Audio;
  song: Song;
  p: Progress;
  save: () => void;
  onExit: () => void;
  onDone: (o: PlayOutcome) => void;

  constructor(audio: Audio, song: Song, p: Progress, save: () => void, onExit: () => void, onDone: (o: PlayOutcome) => void, practice?: { from: number; to: number }) {
    this.audio = audio;
    this.song = song;
    this.p = p;
    this.save = save;
    this.onExit = onExit;
    this.onDone = onDone;
    if (practice) {
      this.practiceFrom = practice.from;
      this.practiceTo = practice.to;
    }
    this.clock = new BeatClock(secPerBeat(song.bpm, SPEEDS[p.settings.speed], p.settings.tempoPct));
    this.strip = new Strip(song);
    this.root = h("section", { class: "screen play", "data-testid": "play" });
    const mode = segmented<ViewMode>(
      [
        { v: "tabs", label: "Tabs", testid: "mode-tabs" },
        { v: "both", label: "Tabs + Noten", testid: "mode-both" },
        { v: "notes", label: "Noten", testid: "mode-notes" },
      ],
      p.settings.mode,
      (v) => {
        p.settings.mode = v;
        save();
        this.layout();
      },
      "seg mode-seg",
    );
    this.scoreEl = h("div", { class: "score", "data-testid": "score" }, "0");
    this.comboEl = h("div", { class: "combo", "data-testid": "combo" });
    const top = h(
      "header",
      { class: "topbar" },
      btn("✕", "icon-btn", () => this.exit(), "exit", "Zurück zur Liederliste"),
      h("div", { class: "title" }, h("span", { class: "t-emoji" }, song.emoji), h("span", { class: "t-name" }, song.title)),
      h("div", { class: "scorebox" }, h("span", { class: "score-label" }, "Punkte"), this.scoreEl, this.comboEl),
      mode.el,
    );
    this.stage = h("div", { class: "stage" });
    this.stage.append(this.strip.el);
    this.feedback = h("div", { class: "feedback", "data-testid": "feedback", "aria-live": "polite" });
    this.feedbackSub = h("div", { class: "feedback-sub", "data-testid": "feedback-sub" });
    this.countEl = h("div", { class: "countin", "data-testid": "countin" });
    this.owlSay = h("div", { class: "owl-say", "data-testid": "owl-say" });
    this.owlBox = h("div", { class: "owl-box", html: owlSvg("happy", 72) });
    this.stage.append(h("div", { class: "fb-wrap" }, this.feedback, this.feedbackSub), this.countEl, h("div", { class: "owl-corner" }, this.owlSay, this.owlBox));
    this.hintEl = h("div", { class: "hint", "data-testid": "hint" });
    this.progressEl = h("div", { class: "progress-fill" });
    this.pauseBtn = btn("⏸ Pause", "btn btn-soft", () => this.pauseToggle(), "pause");
    const bottom = h("footer", { class: "bottombar" }, this.pauseBtn, h("div", { class: "progress" }, this.progressEl), this.hintEl);
    this.overlay = h("div", { class: "overlay", "data-testid": "ready" });
    this.root.append(top, this.stage, bottom);
    this.stage.append(this.overlay);
    this.showReady();
    new ResizeObserver(() => this.layout()).observe(this.stage);
    (window as unknown as { __gs: object }).__gs = Object.assign((window as unknown as { __gs?: object }).__gs ?? {}, { play: this });
  }

  private layout() {
    const w = this.stage.clientWidth;
    const hgt = this.stage.clientHeight;
    if (w < 50 || hgt < 50) return;
    this.strip.build(w, hgt, this.p.settings.mode);
    for (const [i, c] of this.marks) this.strip.mark(i, c);
    this.strip.setBeat(this.state === "ready" ? (this.range ? this.range.from * this.song.beatsPerBar : 0) - 0.6 : this.beatNow());
  }

  private beatNow() {
    const ctx = this.audio.ctx;
    return ctx ? this.clock.beatAt(ctx.currentTime) : 0;
  }

  private say(mood: Mood, text: string) {
    const key = mood + text;
    if (key === this.lastOwl) return;
    this.lastOwl = key;
    this.owlBox.innerHTML = owlSvg(mood, 72);
    this.owlSay.textContent = text;
    this.owlSay.classList.toggle("show", !!text);
  }

  // ---------- ready panel ----------
  private showReady() {
    this.state = "ready";
    const p = this.p;
    const o = this.overlay;
    o.innerHTML = "";
    o.classList.add("show");
    const bars = this.song.chords.length;
    const speed = segmented<SpeedId>(
      (["normal", "turtle", "snail"] as SpeedId[]).map((v) => ({ v, label: `${SPEEDS[v].emoji}\n${SPEEDS[v].label}`, testid: `speed-${v}` })),
      p.settings.speed,
      (v) => {
        p.settings.speed = v;
        this.save();
        speedNote.textContent = speedText(v);
      },
      "seg speed-seg",
    );
    const speedText = (v: SpeedId) => {
      const bpm = Math.round(effectiveBpm(this.song.bpm, SPEEDS[v], p.settings.tempoPct));
      return v === "normal" ? `♩ = ${bpm} · läuft im Takt weiter` : `♩ = ${bpm} (${Math.round(SPEEDS[v].factor * 100)} %) · wartet auf deinen Ton`;
    };
    const speedNote = h("div", { class: "small", "data-testid": "speed-note" }, speedText(p.settings.speed));
    const pctV = h("span", { class: "num", "data-testid": "tempo-pct" }, `${p.settings.tempoPct} %`);
    const fine = (d: number) => () => {
      p.settings.tempoPct = clampTempoPct(p.settings.tempoPct + d);
      pctV.textContent = `${p.settings.tempoPct} %`;
      speedNote.textContent = speedText(p.settings.speed);
      this.save();
    };
    const fineRow = h(
      "div",
      { class: "row" },
      h("span", { class: "lbl" }, "Feintempo"),
      btn("−", "mini", fine(-5), "tempo-minus", "langsamer"),
      pctV,
      btn("+", "mini", fine(5), "tempo-plus", "schneller"),
    );
    const toggle = (label: string, key: "metronome" | "guide", testid: string) => {
      const b = btn(label, "toggle", () => {
        p.settings[key] = !p.settings[key];
        b.setAttribute("aria-pressed", String(p.settings[key]));
        this.save();
      }, testid);
      b.setAttribute("aria-pressed", String(p.settings[key]));
      return b;
    };
    const vol = h("input", { type: "range", min: 0, max: 1, step: 0.05, value: p.settings.backing, "aria-label": "Lautstärke Begleitung", "data-testid": "backing-vol" }) as HTMLInputElement;
    vol.addEventListener("input", () => {
      p.settings.backing = Number(vol.value);
      this.audio.setBacking(p.settings.backing);
      this.save();
    });
    const fromV = h("span", { class: "num", "data-testid": "pr-from" }, String(this.practiceFrom + 1));
    const toV = h("span", { class: "num", "data-testid": "pr-to" }, String(this.practiceTo + 1));
    const upd = () => {
      fromV.textContent = String(this.practiceFrom + 1);
      toV.textContent = String(this.practiceTo + 1);
    };
    const step = (which: "f" | "t", d: number) => () => {
      if (which === "f") this.practiceFrom = Math.max(0, Math.min(bars - 1, this.practiceFrom + d));
      else this.practiceTo = Math.max(0, Math.min(bars - 1, this.practiceTo + d));
      if (this.practiceTo < this.practiceFrom) {
        if (which === "f") this.practiceTo = this.practiceFrom;
        else this.practiceFrom = this.practiceTo;
      }
      upd();
    };
    o.append(
      h(
        "div",
        { class: "ready-card" },
        h("h2", {}, `Bereit, ${p.name || "du"}?`),
        h("div", { class: "small" }, `${this.song.title} · ${this.song.keyName} · ${bars} Takte`),
        h(
          "div",
          { class: "row actions" },
          btn("▶ Los geht's!", "btn btn-big btn-pink", () => this.begin("song"), "start"),
          btn("👂 Anhören", "btn btn-sky", () => this.begin("preview"), "preview"),
        ),
        h("div", { class: "row" }, h("span", { class: "lbl" }, "Tempo"), speed.el),
        speedNote,
        fineRow,
        h(
          "div",
          { class: "row" },
          toggle("🥁 Metronom", "metronome", "tg-metro"),
          toggle("🎵 Melodie vorspielen", "guide", "tg-guide"),
          h("label", { class: "vol" }, h("span", { class: "lbl" }, "🎹 Begleitung"), vol),
        ),
        h(
          "div",
          { class: "row practice-row" },
          h("span", { class: "lbl" }, "🎯 Üben: Takt"),
          btn("−", "mini", step("f", -1), "pr-from-minus", "Anfang früher"),
          fromV,
          btn("+", "mini", step("f", 1), "pr-from-plus", "Anfang später"),
          h("span", { class: "lbl" }, "bis"),
          btn("−", "mini", step("t", -1), "pr-to-minus", "Ende früher"),
          toV,
          btn("+", "mini", step("t", 1), "pr-to-plus", "Ende später"),
          btn("Stelle üben", "btn btn-mint", () => this.begin("practice"), "practice"),
        ),
        this.song.note ? h("div", { class: "tiny" }, this.song.note) : null,
      ),
    );
    this.say("happy", "");
    this.hintEl.textContent = "";
    this.pauseBtn.disabled = true;
    requestAnimationFrame(() => this.layout());
  }

  // ---------- running ----------
  async begin(kind: PlayOutcome["kind"]) {
    this.kind = kind;
    const ctx = this.audio.ensure();
    if (kind !== "preview") {
      try {
        await this.audio.startMic();
      } catch {
        this.say("think", "Ich kann nichts hören. Bitte erlaube das Mikrofon.");
        return;
      }
    }
    const s = this.song;
    const sp = SPEEDS[this.p.settings.speed];
    this.clock.spb = secPerBeat(s.bpm, sp, this.p.settings.tempoPct);
    const bpb = s.beatsPerBar;
    this.range = kind === "practice" ? { from: this.practiceFrom, to: this.practiceTo } : null;
    this.startBeat = (this.range ? this.range.from * bpb : 0) - bpb;
    this.endBeat = this.range ? (this.range.to + 1) * bpb : songBeats(s);
    this.passes = 0;
    this.goodPasses = 0;
    this.overlay.classList.remove("show");
    this.overlay.innerHTML = "";
    this.audio.setBacking(this.p.settings.backing);
    this.backing = new Backing(this.audio, s, this.clock);
    this.backing.metronome = this.p.settings.metronome;
    this.backing.guideOn = kind === "preview" || this.p.settings.guide;
    this.pauseBtn.disabled = false;
    this.pauseBtn.textContent = "⏸ Pause";
    void this.lockScreen();
    this.startPass(ctx.currentTime + 0.15);
    this.audio.onFrame = (f) => this.onFrame(f);
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 20);
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private startPass(at: number) {
    const s = this.song;
    const sp = SPEEDS[this.p.settings.speed];
    const first = this.startBeat + s.beatsPerBar;
    const notes = s.notes.filter((n) => n.midi !== null && n.start >= first && n.start < this.endBeat);
    const speed = this.kind === "preview" ? { ...sp, wait: false } : sp;
    this.judge = this.kind === "preview" ? null : new Judge(notes, speed, this.clock.spb);
    this.marks = [];
    this.strip.clearMarks();
    this.last = null;
    if (this.passes === 0) this.gateSamples = [];
    this.clock.start(at, this.startBeat);
    this.backing!.reset(this.startBeat);
    this.state = "countin";
    this.updateScore();
    this.say(this.kind === "preview" ? "listen" : "happy", this.kind === "preview" ? "Hör mal zu!" : this.kind === "practice" ? `Wir üben Takt ${this.range!.from + 1}–${this.range!.to + 1}` : "Los geht's!");
  }

  private tick() {
    const ctx = this.audio.ctx;
    if (!ctx || this.state === "paused" || this.state === "done" || this.state === "ready") return;
    const now = ctx.currentTime;
    const j = this.judge;
    let beat = this.clock.beatAt(now);
    if (j && j.speed.wait && j.shouldHoldAt(beat) && !this.clock.isFrozen) {
      this.clock.freeze(j.holdBeat());
      this.frozenAt = performance.now();
      this.backing!.holdChord(j.notes[j.index].start);
      beat = this.clock.beatAt(now);
    }
    const barrier = j && j.speed.wait && !j.done ? j.holdBeat() : Infinity;
    this.backing!.tick(now, 0.12, barrier, this.endBeat);
    if (beat < this.startBeat + this.song.beatsPerBar) this.state = "countin";
    else this.state = this.clock.isFrozen ? "waiting" : "running";
    const finished = j ? (j.speed.wait ? j.done && beat >= this.endBeat : beat >= this.endBeat + 0.25) : beat >= this.endBeat + 0.5;
    if (finished) this.endPass();
  }

  private onFrame(f: MicFrame) {
    const j = this.judge;
    if (!j || this.state === "paused" || this.state === "done" || this.state === "ready") return;
    const beat = this.clock.beatAt(f.time);
    if (beat < this.startBeat + this.song.beatsPerBar - 0.3) {
      // first count-in: learn the room + speaker level so the backing does not count as playing
      if (this.passes > 0) return;
      this.gateSamples.push(f.rms);
      const s = [...this.gateSamples].sort((a, b) => a - b);
      this.audio.setGate(Math.max(0.004, Math.min(0.02, s[Math.floor(s.length * 0.3)] * 2.5)));
      return;
    }
    const pitched = f.freq > 0 && f.clarity > 0.8;
    const out = j.push({ beat, freq: f.freq, clarity: f.clarity, rms: f.rms, onset: f.onset });
    const cur = j.done ? null : j.notes[j.index];
    this.strip.showPitch(pitched ? freqToMidi(f.freq) : null, !!cur && pitched && Math.abs(centsOff(f.freq, cur.midi!)) <= j.speed.tol);
    for (const r of out) this.onJudgement(r);
    if (this.clock.isFrozen && !j.shouldHoldAt(this.clock.beatAt(f.time))) {
      this.clock.resume(this.audio.ctx!.currentTime);
      this.backing!.releaseHold();
    }
  }

  private onJudgement(r: Judgement) {
    this.last = r;
    const i = this.song.notes.indexOf(r.note);
    const cls = r.pitch === "super" ? "hit-good" : r.pitch === "hoch" || r.pitch === "tief" ? "hit-ok" : "hit-bad";
    this.marks.push([i, cls]);
    this.strip.mark(i, cls);
    this.feedback.textContent = r.pitch === "verpasst" ? "Ups, verpasst" : PITCH_TEXT[r.pitch];
    this.feedback.className = `feedback show fb-${r.pitch}`;
    this.feedbackSub.textContent = r.time === "frueh" ? "etwas früh" : r.time === "spaet" ? "etwas spät" : r.points > 0 ? `+${r.points + r.bonus}` : "";
    window.clearTimeout(this.fbTimer);
    this.fbTimer = window.setTimeout(() => this.feedback.classList.remove("show"), 900);
    this.updateScore();
    if (r.combo === 5 || r.combo === 10 || r.combo === 20) this.say("cheer", `${r.combo} Super-Töne hintereinander!`);
    else if (r.pitch === "verpasst" || r.pitch.startsWith("viel")) this.say("think", "Weiter so, du schaffst das!");
    else if (r.pitch === "super" && r.combo === 1) this.say("happy", "");
  }

  private updateScore() {
    const rs = this.judge?.results ?? [];
    const sum = rs.reduce((s, r) => s + r.points + r.bonus, 0);
    this.scoreEl.textContent = String(sum);
    const c = this.judge?.combo ?? 0;
    this.comboEl.textContent = c >= 2 ? `🔥 ${c}er Serie` : "";
  }

  drawnBeat = 0;
  private shown = { count: "", progress: -1, hint: "", waiting: false };
  /** per-frame work: one transform for the notes, everything else only when its value changes */
  private draw() {
    const ctx = this.audio.ctx;
    if (!ctx || this.state === "ready") return;
    const beat = this.clock.beatAt(this.audio.smoothNow());
    this.drawnBeat = beat;
    this.strip.setBeat(beat);
    const bpb = this.song.beatsPerBar;
    const count = beat < this.startBeat + bpb ? String(Math.max(1, Math.min(bpb, Math.floor(beat - this.startBeat) + 1))) : "";
    if (count !== this.shown.count) {
      this.shown.count = count;
      this.countEl.textContent = count;
      this.countEl.classList.toggle("show", !!count);
    }
    const span = this.endBeat - (this.startBeat + bpb);
    const prog = Math.round(Math.max(0, Math.min(1, (beat - this.startBeat - bpb) / span)) * 400) / 400;
    if (prog !== this.shown.progress) {
      this.shown.progress = prog;
      this.progressEl.style.transform = `scaleX(${prog})`;
    }
    const j = this.judge;
    let hint = "";
    let waiting = false;
    if (j && !j.done && this.state !== "countin") {
      const n = j.notes[j.index];
      if (this.clock.isFrozen && performance.now() - this.frozenAt > 350) {
        hint = `Spiele: ${noteHint(n)}`;
        waiting = true;
        const live = j.liveHint;
        this.say("listen", live ? (live.includes("hoch") ? "Etwas zu hoch – Finger ein bisschen zurück" : "Etwas zu tief – Finger ein bisschen vor") : `Ich warte auf dich: ${pitchClassName(n.midi!)}`);
      } else hint = `Nächster Ton: ${noteHint(n)}`;
    } else if (!j) hint = this.kind === "preview" ? "Anhören – so klingt das Lied" : "";
    if (hint !== this.shown.hint) {
      this.shown.hint = hint;
      this.hintEl.textContent = hint;
    }
    if (waiting !== this.shown.waiting) {
      this.shown.waiting = waiting;
      this.hintEl.classList.toggle("waiting", waiting);
    }
  }

  private endPass() {
    const j = this.judge;
    if (!j) return this.finish(null);
    j.flush();
    const sum = summarise(j.results, j.maxCombo);
    if (this.kind === "practice") {
      this.passes++;
      this.goodPasses = sum.accuracy >= 0.85 ? this.goodPasses + 1 : 0;
      if (this.goodPasses >= 2) return this.finish(sum);
      this.say(
        sum.accuracy >= 0.85 ? "cheer" : "think",
        `Durchgang ${this.passes}: ${Math.round(sum.accuracy * 100)} %${sum.accuracy >= 0.85 ? " – noch einmal so!" : " – nochmal!"}`,
      );
      this.startPass(this.audio.ctx!.currentTime + 0.3);
      return;
    }
    this.finish(sum);
  }

  private finish(sum: Summary | null) {
    this.stopLoops();
    this.state = "done";
    const res = this.judge?.results ?? [];
    this.onDone({ kind: this.kind, summary: sum ?? summarise([], 0), results: res, speed: this.p.settings.speed, range: this.range, passes: this.passes });
  }

  private stopLoops() {
    window.clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.timer = 0;
    this.audio.onFrame = null;
    this.backing?.releaseHold();
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  private pauseToggle() {
    const ctx = this.audio.ctx;
    if (!ctx || this.state === "ready" || this.state === "done") return;
    if (this.state !== "paused") {
      void ctx.suspend();
      this.state = "paused";
      this.pauseBtn.textContent = "▶ Weiter";
      this.overlay.innerHTML = "";
      this.overlay.classList.add("show");
      this.overlay.append(
        h(
          "div",
          { class: "ready-card pause-card" },
          h("h2", {}, "Pause"),
          h(
            "div",
            { class: "row actions" },
            btn("▶ Weiter", "btn btn-big btn-pink", () => this.pauseToggle(), "resume"),
            btn("↺ Neu starten", "btn btn-sky", () => this.restart(), "restart"),
            btn("☰ Liederliste", "btn btn-soft", () => this.exit(), "to-list"),
          ),
        ),
      );
    } else {
      this.overlay.classList.remove("show");
      this.overlay.innerHTML = "";
      void ctx.resume();
      this.state = "running";
      this.pauseBtn.textContent = "⏸ Pause";
    }
  }

  private restart() {
    this.stopLoops();
    void this.audio.ctx?.resume();
    this.marks = [];
    this.strip.clearMarks();
    this.judge = null;
    this.updateScore();
    this.showReady();
  }

  private async lockScreen() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl) this.wakeLock = await wl.request("screen");
    } catch {
      this.wakeLock = null;
    }
  }

  exit() {
    this.destroy();
    this.onExit();
  }

  destroy() {
    this.stopLoops();
    if (this.audio.ctx?.state === "suspended") void this.audio.ctx.resume();
  }

  /** test/debug view */
  view() {
    const j = this.judge;
    return {
      state: this.state,
      beat: this.beatNow(),
      drawnBeat: this.drawnBeat,
      index: j?.index ?? -1,
      waiting: this.clock.isFrozen,
      score: Number(this.scoreEl.textContent),
      combo: j?.combo ?? 0,
      results: j?.results.length ?? 0,
      last: this.last ? { pitch: this.last.pitch, time: this.last.time, points: this.last.points } : null,
      gate: this.audio.gate,
      spb: this.clock.spb,
      startBeat: this.startBeat,
      endBeat: this.endBeat,
    };
  }
  /** performance.now() timestamp (ms) of a beat on the running clock */
  perfOfBeat(beat: number) {
    const ctx = this.audio.ctx!;
    return performance.now() + (this.clock.timeOf(beat) - ctx.currentTime) * 1000;
  }
  /** the note the judge expects next (for the fake mic in tests) */
  expected() {
    const j = this.judge;
    return j && !j.done ? j.notes[j.index].midi : null;
  }
}
