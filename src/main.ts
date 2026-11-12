import "./style.css";
import { Audio } from "./audio/engine.ts";
import { worstPassage } from "./core/judge.ts";
import { BADGES, applyRun, loadProgress, markDay, saveProgress, streak } from "./core/progress.ts";
import { SONGS, songById, type Song } from "./core/songs.ts";
import { SPEEDS } from "./core/speed.ts";
import { PlayScreen, type PlayOutcome } from "./play.ts";
import { TunerScreen } from "./tuner.ts";
import { btn, confetti, h, starsText } from "./ui/dom.ts";
import { owlSvg } from "./ui/owl.ts";

const params = new URLSearchParams(location.search);
const p = loadProgress();
const save = () => saveProgress(p);
const audio = new Audio();
const app = document.getElementById("app")!;
let cleanup: (() => void) | null = null;
const gs = { audio, progress: p, screen: "home", play: null as unknown, tuner: null as TunerScreen | null };
(window as unknown as { __gs: typeof gs }).__gs = gs;

function show(el: HTMLElement, name: string) {
  cleanup?.();
  cleanup = null;
  app.innerHTML = "";
  app.append(el);
  gs.screen = name;
  app.dataset.screen = name;
  window.scrollTo(0, 0);
}

// ---------- home ----------
function home() {
  const st = streak(p.days, new Date());
  const greet = h("h1", { class: "greet", "data-testid": "greeting" }, `Hallo ${p.name || "du"}!`);
  const nameEdit = btn("✏️", "icon-btn small-icon", () => editName(), "edit-name", "Namen ändern");
  const streakEl = h(
    "div",
    { class: "streak", "data-testid": "streak" },
    st >= 2 ? `🔥 ${st} Tage hintereinander geübt` : st === 1 ? "🔥 1 Tag geübt – morgen wieder?" : "Heute schon geübt? Los geht's!",
  );
  const list = h("div", { class: "songs", "data-testid": "songs" });
  SONGS.forEach((s) => {
    const sp = p.songs[s.id];
    const card = h(
      "button",
      { class: "song-card", type: "button", "data-testid": `song-${s.id}`, "aria-label": `${s.title}, ${sp?.stars ?? 0} Sterne` },
      h("span", { class: "song-emoji", "aria-hidden": "true" }, s.emoji),
      h(
        "span",
        { class: "song-main" },
        h("span", { class: "song-title" }, s.title),
        h("span", { class: "song-sub" }, s.subtitle),
        h("span", { class: "level", "aria-label": `Stufe ${s.level} von 5` }, "●".repeat(s.level) + "○".repeat(5 - s.level)),
      ),
      h(
        "span",
        { class: "song-side" },
        h("span", { class: `stars s${sp?.stars ?? 0}`, "data-testid": `stars-${s.id}` }, starsText(sp?.stars ?? 0)),
        h("span", { class: "best", "data-testid": `best-${s.id}` }, sp?.best ? `Bestwert ${sp.best}` : "neu"),
      ),
    );
    card.addEventListener("click", () => openSong(s));
    list.append(card);
  });
  const badges = h("div", { class: "badges", "data-testid": "badges" });
  for (const b of BADGES) {
    const got = p.badges.includes(b.id);
    badges.append(h("div", { class: `badge ${got ? "got" : ""}`, title: b.text, "data-testid": `badge-${b.id}` }, h("span", { class: "b-emoji" }, b.emoji), h("span", { class: "b-title" }, b.title)));
  }
  const totalStars = SONGS.reduce((n, s) => n + (p.songs[s.id]?.stars ?? 0), 0);
  const root = h(
    "section",
    { class: "screen home", "data-testid": "home" },
    h(
      "div",
      { class: "home-head" },
      h("div", { class: "owl-big", html: owlSvg(st >= 3 ? "cheer" : "happy", 92) }),
      h("div", { class: "head-text" }, h("div", { class: "name-row" }, greet, nameEdit), streakEl, h("div", { class: "small" }, `⭐ ${totalStars} von ${SONGS.length * 3} Sternen`)),
    ),
    h(
      "div",
      { class: "home-body" },
      h("div", { class: "col-songs" }, h("h2", { class: "sec" }, "Wähle ein Lied"), list),
      h(
        "div",
        { class: "col-side" },
        btn("🎻 Stimmgerät", "btn btn-sky wide", () => tuner(null), "open-tuner"),
        h("h2", { class: "sec" }, "Abzeichen"),
        badges,
        h("p", { class: "tiny" }, "Alles bleibt auf diesem Gerät. Das Mikrofon hört nur zu, es wird nichts aufgenommen oder verschickt."),
      ),
    ),
  );
  show(root, "home");
  if (!localStorage.getItem("geigenstern:welcomed")) welcome();

  function editName() {
    const input = h("input", { class: "name-input", value: p.name, maxlength: 20, "aria-label": "Dein Name", "data-testid": "name-input" }) as HTMLInputElement;
    const ok = btn("OK", "btn btn-mint", () => {
      p.name = input.value.trim().slice(0, 20) || p.name;
      save();
      home();
    }, "name-ok");
    const row = root.querySelector(".name-row")!;
    row.replaceChildren(input, ok);
    input.focus();
    input.select();
  }
}

function welcome() {
  const input = h("input", { class: "name-input", value: p.name, maxlength: 20, "aria-label": "Dein Name", "data-testid": "welcome-name" }) as HTMLInputElement;
  const dlg = h(
    "div",
    { class: "modal", "data-testid": "welcome" },
    h(
      "div",
      { class: "modal-card" },
      h("div", { html: owlSvg("wow", 90) }),
      h("h2", {}, "Hallo! Ich bin Pip, die Geigen-Eule."),
      h("p", {}, "Wie heißt du?"),
      input,
      btn("Los geht's!", "btn btn-big btn-pink", () => {
        p.name = input.value.trim().slice(0, 20) || p.name;
        save();
        localStorage.setItem("geigenstern:welcomed", "1");
        dlg.remove();
        home();
      }, "welcome-ok"),
    ),
  );
  app.append(dlg);
}

// ---------- microphone explanation ----------
function withMic(next: () => void) {
  if (p.micExplained) return next();
  const dlg = h(
    "div",
    { class: "modal", "data-testid": "mic-explain" },
    h(
      "div",
      { class: "modal-card" },
      h("div", { html: owlSvg("listen", 84) }),
      h("h2", {}, "Darf ich zuhören?"),
      h("p", {}, "Damit ich merke, welchen Ton du spielst, brauche ich das Mikrofon. Ich höre nur zu – ich nehme nichts auf."),
      h("p", { class: "tiny" }, "Für Eltern: Die Tonhöhe wird direkt im Handy berechnet. Es wird nichts gespeichert, hochgeladen oder verschickt. Ihr Browser fragt gleich nach der Erlaubnis."),
      btn("🎤 Mikrofon erlauben", "btn btn-big btn-pink", () => {
        p.micExplained = true;
        save();
        dlg.remove();
        next();
      }, "mic-ok"),
      btn("Später", "btn btn-soft", () => dlg.remove(), "mic-later"),
    ),
  );
  app.append(dlg);
}

// ---------- tuner ----------
function tuner(song: Song | null) {
  withMic(() => {
    audio.ensure();
    const t = new TunerScreen(
      audio,
      song ? `Stimmen vor: ${song.title}` : "Stimmgerät",
      () => (song ? play(song) : home()),
      () => (song ? play(song) : home()),
      song ? "Weiter zum Lied" : "Fertig",
    );
    show(t.root, "tuner");
    gs.tuner = t;
    cleanup = () => {
      t.stop();
      gs.tuner = null;
    };
    t.start().catch(() => {
      const msg = t.root.querySelector("[data-testid=tuner-msg]");
      if (msg) msg.textContent = "Kein Mikrofon – bitte erlauben.";
    });
  });
}

// ---------- play ----------
const tunedThisSession = new Set<string>();
function openSong(s: Song) {
  if (p.settings.tunerFirst && !tunedThisSession.has("any") && !params.has("notuner")) {
    tunedThisSession.add("any");
    return tuner(s);
  }
  withMic(() => play(s));
}

function play(s: Song, practice?: { from: number; to: number }) {
  audio.ensure();
  const ps = new PlayScreen(audio, s, p, save, () => home(), (o) => results(s, o), practice);
  show(ps.root, "play");
  gs.play = ps;
  cleanup = () => ps.destroy();
}

// ---------- results ----------
function results(s: Song, o: PlayOutcome) {
  if (o.kind === "preview") return play(s);
  const sum = o.summary;
  let newBadges: string[] = [];
  let newBest = false;
  if (o.kind === "song") {
    const r = applyRun(p, { songId: s.id, score: sum.score, stars: sum.stars, perfect: sum.perfect, speed: o.speed }, SONGS.map((x) => x.id), new Date());
    newBadges = r.newBadges;
    newBest = r.newBest;
  } else markDay(p, new Date());
  save();
  const worst = o.kind === "song" ? worstPassage(sum.barAccuracy, s.chords.length) : null;
  const high = o.results.filter((r) => r.pitch === "hoch" || r.pitch === "viel-hoch").length;
  const low = o.results.filter((r) => r.pitch === "tief" || r.pitch === "viel-tief").length;
  const late = o.results.filter((r) => r.time === "spaet").length;
  const early = o.results.filter((r) => r.time === "frueh").length;
  const tips: string[] = [];
  if (low >= Math.max(3, high * 1.5)) tips.push("Oft etwas zu tief: setz den Finger ein kleines bisschen weiter Richtung Steg.");
  else if (high >= Math.max(3, low * 1.5)) tips.push("Oft etwas zu hoch: setz den Finger ein kleines bisschen weiter Richtung Schnecke.");
  if (late >= 4 && late > early) tips.push("Manchmal etwas spät – hör auf den Takt der Begleitung.");
  else if (early >= 4) tips.push("Manchmal etwas früh – lass dir Zeit.");
  const practice = o.kind === "practice";
  const stars = h("div", { class: "big-stars", "data-testid": "result-stars", "aria-label": `${sum.stars} von 3 Sternen` });
  for (let i = 0; i < 3; i++) stars.append(h("span", { class: `bs ${i < sum.stars ? "on" : ""}`, style: `animation-delay:${0.3 + i * 0.45}s` }, "★"));
  const msg = practice
    ? o.passes && sum.accuracy >= 0.85
      ? `Geschafft! Takt ${o.range!.from + 1}–${o.range!.to + 1} sitzt.`
      : "Gut geübt!"
    : sum.stars === 3
      ? `Fantastisch, ${p.name}!`
      : sum.stars === 2
        ? `Toll gemacht, ${p.name}!`
        : sum.stars === 1
          ? "Gut gemacht! Weiter so!"
          : "Super, dass du übst! Probier's mit der Schnecke 🐌";
  const bars = h("div", { class: "bar-chart", "aria-label": "Treffer pro Takt" });
  for (let b = 0; b < s.chords.length; b++) {
    const a = sum.barAccuracy.get(b);
    if (a === undefined) continue;
    bars.append(h("span", { class: `bc ${a >= 0.85 ? "g" : a >= 0.6 ? "m" : "l"}`, style: `height:${Math.max(8, a * 100)}%`, title: `Takt ${b + 1}: ${Math.round(a * 100)} %` }));
  }
  const root = h(
    "section",
    { class: "screen results", "data-testid": "results" },
    h(
      "div",
      { class: "res-card" },
      h("div", { class: "res-left" }, h("div", { html: owlSvg(sum.stars >= 2 ? "cheer" : sum.stars === 1 ? "happy" : "think", 110) }), stars),
      h(
        "div",
        { class: "res-right" },
        h("h1", { class: "res-title" }, msg),
        h("div", { class: "small" }, `${s.title} · ${SPEEDS[o.speed].emoji} ${SPEEDS[o.speed].label}${practice ? " · Übung" : ""}`),
        h(
          "div",
          { class: "res-stats" },
          h("div", {}, h("b", { "data-testid": "result-score" }, String(sum.score)), h("span", {}, "Punkte")),
          h("div", {}, h("b", { "data-testid": "result-acc" }, `${Math.round(sum.accuracy * 100)} %`), h("span", {}, "getroffen")),
          h("div", {}, h("b", {}, `${sum.perfect}/${sum.notes}`), h("span", {}, "Super-Töne")),
          h("div", {}, h("b", {}, String(sum.maxCombo)), h("span", {}, "längste Serie")),
        ),
        newBest ? h("div", { class: "new-best", "data-testid": "new-best" }, "🏅 Neuer Rekord!") : null,
        bars,
        ...tips.map((t) => h("p", { class: "tip" }, `💡 ${t}`)),
        newBadges.length
          ? h(
              "div",
              { class: "new-badges", "data-testid": "new-badges" },
              ...newBadges.map((id) => {
                const b = BADGES.find((x) => x.id === id)!;
                return h("div", { class: "badge got pop" }, h("span", { class: "b-emoji" }, b.emoji), h("span", { class: "b-title" }, b.title));
              }),
            )
          : null,
        h(
          "div",
          { class: "row actions" },
          btn("↺ Nochmal", "btn btn-pink", () => play(s), "again"),
          worst && worst.accuracy < 0.95 ? btn(`🎯 Takt ${worst.from + 1}–${worst.to + 1} üben`, "btn btn-mint", () => play(s, worst), "practice-worst") : null,
          btn("☰ Liederliste", "btn btn-soft", () => home(), "to-home"),
        ),
        h("p", { class: "tiny" }, "Sterne: ab 50 % ★ · ab 70 % ★★ · ab 88 % ★★★"),
      ),
    ),
  );
  show(root, "results");
  if (sum.stars >= 1 || (practice && sum.accuracy >= 0.85)) confetti(root);
}

// ---------- boot ----------
home();
const startSong = params.get("song");
if (startSong && songById(startSong)) withMic(() => play(songById(startSong)!));

if ("serviceWorker" in navigator && !params.has("nosw") && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => undefined);
}
