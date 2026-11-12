import type { Audio } from "./audio/engine.ts";
import { A4_PRESETS, a4FromMeasurement, centsOff, getA4, setA4, STRINGS, type StringName } from "./core/music.ts";
import { btn, h } from "./ui/dom.ts";
import { STRING_COLORS } from "./ui/strip.ts";

/** Pick the open string closest to a frequency (within ±350 cents). */
export function nearestString(freq: number): { name: StringName; cents: number } | null {
  let best: { name: StringName; cents: number } | null = null;
  for (const s of STRINGS) {
    const c = centsOff(freq, s.midi);
    if (Math.abs(c) <= 350 && (!best || Math.abs(c) < Math.abs(best.cents))) best = { name: s.name, cents: c };
  }
  return best;
}

export class TunerScreen {
  root: HTMLElement;
  private needle: SVGElement;
  private noteEl: HTMLElement;
  private msgEl: HTMLElement;
  private face: HTMLElement;
  private strBtns = new Map<StringName, HTMLButtonElement>();
  private okSince = 0;
  private smooth = 0;
  private lastSeen = 0;
  done = new Set<StringName>();
  current: StringName | null = null;
  cents = 0;
  audio: Audio;
  private a4El!: HTMLElement;
  private a4Msg!: HTMLElement;
  private measuring: number[] | null = null;
  private onA4: (hz: number) => void;
  constructor(audio: Audio, title: string, onNext: () => void, onSkip: () => void, nextLabel: string, onA4: (hz: number) => void) {
    this.audio = audio;
    this.onA4 = onA4;
    this.root = h("section", { class: "screen tuner", "data-testid": "tuner" });
    const svgNS = "http://www.w3.org/2000/svg";
    const gauge = document.createElementNS(svgNS, "svg");
    gauge.setAttribute("viewBox", "0 0 240 140");
    gauge.setAttribute("class", "gauge");
    gauge.innerHTML = `
      <path d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke="#ffd9e3" stroke-width="18" stroke-linecap="round"/>
      <path d="M100.9 21.8 A100 100 0 0 1 139.1 21.8" fill="none" stroke="#a8e6c8" stroke-width="18"/>
      <text x="22" y="138" class="g-lbl">tief</text><text x="218" y="138" class="g-lbl" text-anchor="end">hoch</text>
      <line x1="120" y1="120" x2="120" y2="30" stroke="#6249b3" stroke-width="5" stroke-linecap="round" class="needle"/>
      <circle cx="120" cy="120" r="9" fill="#6249b3"/>`;
    this.needle = gauge.querySelector(".needle")!;
    this.noteEl = h("div", { class: "tn-note", "data-testid": "tuner-note" }, "–");
    this.msgEl = h("div", { class: "tn-msg", "data-testid": "tuner-msg" }, "Spiele eine leere Saite");
    this.face = h("div", { class: "tn-face", "aria-hidden": "true" }, "🙂");
    const strings = h("div", { class: "tn-strings" });
    for (const s of STRINGS) {
      const b = btn(s.name, "tn-str", () => this.audio.refTone(s.midi), `tstr-${s.name}`, `${s.name}-Saite anhören`);
      b.style.setProperty("--c", STRING_COLORS[s.name].fill);
      b.style.setProperty("--ink", STRING_COLORS[s.name].ink);
      this.strBtns.set(s.name, b);
      strings.append(b);
    }
    this.root.append(
      h(
        "header",
        { class: "topbar" },
        btn("✕", "icon-btn", () => onSkip(), "tuner-close", "Schließen"),
        h("div", { class: "title" }, h("span", { class: "t-emoji" }, "🎻"), h("span", { class: "t-name" }, title)),
      ),
      h(
        "div",
        { class: "tn-body" },
        h("div", { class: "tn-left" }, gauge, h("div", { class: "tn-read" }, this.face, this.noteEl), this.msgEl),
        h(
          "div",
          { class: "tn-right" },
          h("p", { class: "small" }, "Streiche eine leere Saite. Tippe auf einen Buchstaben, um den Ton zu hören."),
          strings,
          this.a4Row(),
          h("div", { class: "row actions" }, btn(nextLabel, "btn btn-big btn-pink", () => onNext(), "tuner-next"), btn("Überspringen", "btn btn-soft", () => onSkip(), "tuner-skip")),
        ),
      ),
    );
  }

  private a4Row() {
    this.a4El = h("span", { class: "num a4-val", "data-testid": "a4-value" }, `${getA4()} Hz`);
    this.a4Msg = h("div", { class: "tiny", "data-testid": "a4-msg" }, "Meist 440 Hz, manche Geigen 432 oder 442. Gilt für Stimmgerät, Bewertung und Begleitung.");
    const set = (hz: number) => {
      const v = setA4(hz);
      this.a4El.textContent = `${v} Hz`;
      this.onA4(v);
    };
    return h(
      "div",
      { class: "a4-box" },
      h("div", { class: "lbl" }, "Kammerton (Ton der leeren A-Saite)"),
      h(
        "div",
        { class: "row" },
        btn("−", "mini", () => set(getA4() - 1), "a4-minus", "1 Hz tiefer"),
        this.a4El,
        btn("+", "mini", () => set(getA4() + 1), "a4-plus", "1 Hz höher"),
      ),
      h(
        "div",
        { class: "row" },
        ...A4_PRESETS.map((hz) => btn(String(hz), "toggle", () => set(hz), `a4-${hz}`)),
        btn("🎯 Automatisch (A-Saite)", "toggle", () => this.measureA4(set), "a4-auto"),
      ),
      this.a4Msg,
    );
  }

  private measureA4(set: (hz: number) => void) {
    this.measuring = [];
    this.a4Msg.textContent = "Streiche jetzt 3 Sekunden lang die leere A-Saite …";
    window.setTimeout(() => {
      const got = this.measuring ?? [];
      this.measuring = null;
      const hz = a4FromMeasurement(got);
      if (hz === null) this.a4Msg.textContent = "Ich habe kein A gehört. Streiche die leere A-Saite und probier es nochmal.";
      else {
        set(hz);
        this.a4Msg.textContent = `Gemessen: Kammerton ${hz} Hz.`;
      }
    }, 3000);
  }

  async start() {
    await this.audio.startMic();
    this.audio.setGate(0.004);
    this.audio.onFrame = (f) => {
      const now = performance.now();
      if (this.measuring && f.freq > 0 && f.clarity > 0.85) this.measuring.push(f.freq);
      const st = f.freq > 0 && f.clarity > 0.85 ? nearestString(f.freq) : null;
      if (!st) {
        if (now - this.lastSeen > 600) {
          this.msgEl.textContent = "Spiele eine leere Saite";
          this.msgEl.className = "tn-msg";
          this.face.textContent = "🙂";
          this.okSince = 0;
        }
        return;
      }
      this.lastSeen = now;
      if (st.name !== this.current) this.smooth = st.cents;
      this.current = st.name;
      this.smooth = this.smooth * 0.6 + st.cents * 0.4;
      this.cents = this.smooth;
      const c = Math.max(-50, Math.min(50, this.smooth));
      this.needle.setAttribute("transform", `rotate(${c * 1.2} 120 120)`);
      this.noteEl.textContent = `${st.name}  ${this.smooth > 0 ? "+" : ""}${Math.round(this.smooth)} ct`;
      for (const [n, b] of this.strBtns) b.classList.toggle("active", n === st.name);
      if (Math.abs(this.smooth) <= 10) {
        if (!this.okSince) this.okSince = now;
        this.msgEl.textContent = "passt!";
        this.msgEl.className = "tn-msg ok";
        this.face.textContent = "😊";
        if (now - this.okSince > 600) {
          this.done.add(st.name);
          this.strBtns.get(st.name)!.classList.add("done");
        }
      } else {
        this.okSince = 0;
        const low = this.smooth < 0;
        this.msgEl.textContent = low ? "zu tief – etwas höher stimmen" : "zu hoch – etwas tiefer stimmen";
        this.msgEl.className = "tn-msg off";
        this.face.textContent = Math.abs(this.smooth) > 30 ? "😮" : "🙂";
      }
    };
  }
  stop() {
    this.audio.onFrame = null;
  }
  /** live value for tests */
  view() {
    return { string: this.current, cents: this.cents, msg: this.msgEl.textContent, done: [...this.done] };
  }
}
