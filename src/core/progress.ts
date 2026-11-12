// Local-only progress: stars, best scores, streak, badges. Nothing leaves the device.
export interface SongProgress {
  stars: 0 | 1 | 2 | 3;
  best: number;
  plays: number;
}
export interface Progress {
  name: string;
  songs: Record<string, SongProgress>;
  /** local dates (YYYY-MM-DD) with at least one finished song or practice */
  days: string[];
  perfectTotal: number;
  badges: string[];
  settings: {
    mode: "tabs" | "both" | "notes";
    speed: "normal" | "turtle" | "snail";
    backing: number;
    metronome: boolean;
    guide: boolean;
    tunerFirst: boolean;
  };
  micExplained: boolean;
}
export const DEFAULT_NAME = "Liviana";
export const defaultProgress = (): Progress => ({
  name: DEFAULT_NAME,
  songs: {},
  days: [],
  perfectTotal: 0,
  badges: [],
  settings: { mode: "tabs", speed: "turtle", backing: 0.5, metronome: false, guide: false, tunerFirst: true },
  micExplained: false,
});

export interface BadgeDef {
  id: string;
  emoji: string;
  title: string;
  text: string;
}
export const BADGES: BadgeDef[] = [
  { id: "first", emoji: "🎻", title: "Erstes Lied", text: "Dein erstes Lied ganz gespielt" },
  { id: "three", emoji: "🌟", title: "Drei Sterne", text: "Ein Lied mit 3 Sternen" },
  { id: "streak3", emoji: "🔥", title: "3 Tage", text: "3 Tage hintereinander geübt" },
  { id: "streak7", emoji: "🏆", title: "7 Tage", text: "7 Tage hintereinander geübt" },
  { id: "perfect100", emoji: "💯", title: "100 Super-Töne", text: "100 Töne genau getroffen" },
  { id: "all", emoji: "🎶", title: "Alle Lieder", text: "Jedes Lied einmal gespielt" },
  { id: "allstars", emoji: "👑", title: "Sternen-Profi", text: "Alle Lieder mit 3 Sternen" },
  { id: "normal", emoji: "🐇", title: "Hasen-Tempo", text: "Ein Lied im normalen Tempo mit 2+ Sternen" },
];

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Consecutive practice days ending today (or yesterday, so the streak is not lost before today's practice). */
export function streak(days: string[], today: Date): number {
  const set = new Set(days);
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export interface RunResult {
  songId: string;
  score: number;
  stars: 0 | 1 | 2 | 3;
  perfect: number;
  speed: "normal" | "turtle" | "snail";
}
/** Applies a finished run; returns newly earned badge ids and whether it was a new best. */
export function applyRun(p: Progress, r: RunResult, allSongIds: string[], now: Date): { newBadges: string[]; newBest: boolean; prevStars: number } {
  const sp = p.songs[r.songId] ?? { stars: 0, best: 0, plays: 0 };
  const prevStars = sp.stars;
  const newBest = r.score > sp.best;
  p.songs[r.songId] = { stars: Math.max(sp.stars, r.stars) as 0 | 1 | 2 | 3, best: Math.max(sp.best, r.score), plays: sp.plays + 1 };
  markDay(p, now);
  p.perfectTotal += r.perfect;
  const earned: string[] = [];
  const give = (id: string, cond: boolean) => {
    if (cond && !p.badges.includes(id)) {
      p.badges.push(id);
      earned.push(id);
    }
  };
  give("first", true);
  give("three", r.stars === 3);
  const st = streak(p.days, now);
  give("streak3", st >= 3);
  give("streak7", st >= 7);
  give("perfect100", p.perfectTotal >= 100);
  give("all", allSongIds.every((id) => (p.songs[id]?.plays ?? 0) > 0));
  give("allstars", allSongIds.every((id) => p.songs[id]?.stars === 3));
  give("normal", r.speed === "normal" && r.stars >= 2);
  return { newBadges: earned, newBest, prevStars };
}
export function markDay(p: Progress, now: Date) {
  const k = dayKey(now);
  if (!p.days.includes(k)) p.days.push(k);
  p.days = p.days.slice(-400);
}

const KEY = "geigenstern:v1";
export function loadProgress(storage: Pick<Storage, "getItem"> = localStorage): Progress {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? "null");
    if (!raw) return defaultProgress();
    const d = defaultProgress();
    return { ...d, ...raw, settings: { ...d.settings, ...(raw.settings ?? {}) } };
  } catch {
    return defaultProgress();
  }
}
export function saveProgress(p: Progress, storage: Pick<Storage, "setItem"> = localStorage) {
  storage.setItem(KEY, JSON.stringify(p));
}
