// "Pip", the original pastel owl mascot (own design).
export type Mood = "happy" | "cheer" | "think" | "wow" | "listen";

export function owlSvg(mood: Mood = "happy", size = 96): string {
  const wingL =
    mood === "cheer" ? "M30 70 Q8 50 14 28 Q26 44 38 58 Z" : mood === "wow" ? "M30 72 Q10 66 12 48 Q24 58 36 64 Z" : "M30 64 Q16 80 26 100 Q34 86 38 74 Z";
  const wingR =
    mood === "cheer" ? "M90 70 Q112 50 106 28 Q94 44 82 58 Z" : mood === "wow" ? "M90 72 Q110 66 108 48 Q96 58 84 64 Z" : "M90 64 Q104 80 94 100 Q86 86 82 74 Z";
  const eyes =
    mood === "cheer"
      ? `<path d="M36 52 Q45 42 54 52" class="owl-ink" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M66 52 Q75 42 84 52" class="owl-ink" stroke-width="4" fill="none" stroke-linecap="round"/>`
      : `<g class="owl-eyes"><circle cx="45" cy="50" r="${mood === "wow" ? 9 : 7}" fill="#3b3355"/><circle cx="75" cy="50" r="${mood === "wow" ? 9 : 7}" fill="#3b3355"/>
         <circle cx="${mood === "think" ? 47 : 48}" cy="${mood === "think" ? 45 : 47}" r="2.6" fill="#fff"/><circle cx="${mood === "think" ? 77 : 78}" cy="${mood === "think" ? 45 : 47}" r="2.6" fill="#fff"/></g>`;
  const mouth =
    mood === "cheer" || mood === "wow"
      ? `<path d="M54 64 L66 64 L60 74 Z" fill="#ffb38a"/>`
      : `<path d="M55 62 L65 62 L60 69 Z" fill="#ffb38a"/>`;
  const extra =
    mood === "listen"
      ? `<path d="M100 30 q6 6 0 12 M106 24 q12 12 0 24" stroke="#9fd8ff" stroke-width="3" fill="none" stroke-linecap="round"/>`
      : mood === "think"
        ? `<circle cx="104" cy="22" r="4" fill="#d9ccff"/><circle cx="112" cy="12" r="6" fill="#d9ccff"/>`
        : mood === "cheer"
          ? `<path d="M10 16 l3 6 6 1 -5 4 1 6 -5 -3 -5 3 1 -6 -5 -4 6 -1z" fill="#ffe08a"/><path d="M104 8 l2 4 4 1 -3 3 1 4 -4 -2 -4 2 1 -4 -3 -3 4 -1z" fill="#ffe08a"/>`
          : "";
  return `<svg class="owl owl-${mood}" viewBox="0 0 120 124" width="${size}" height="${Math.round((size * 124) / 120)}" role="img" aria-label="Eule Pip">
  <path d="M34 20 L30 4 L48 16 Z M86 20 L90 4 L72 16 Z" fill="#b9a3ec"/>
  <path class="owl-wing" d="${wingL}" fill="#a98fe6"/>
  <path class="owl-wing" d="${wingR}" fill="#a98fe6"/>
  <ellipse cx="60" cy="68" rx="34" ry="48" fill="#c9b6f5"/>
  <ellipse cx="60" cy="84" rx="22" ry="28" fill="#fff4e3"/>
  <path d="M50 82 q5 4 10 0 q5 4 10 0 M48 94 q6 4 12 0 q6 4 12 0" stroke="#f1d9b8" stroke-width="2" fill="none"/>
  <circle cx="45" cy="50" r="15" fill="#fff"/><circle cx="75" cy="50" r="15" fill="#fff"/>
  ${eyes}
  <ellipse cx="34" cy="64" rx="6" ry="3.5" fill="#ffc6d9" opacity=".8"/><ellipse cx="86" cy="64" rx="6" ry="3.5" fill="#ffc6d9" opacity=".8"/>
  ${mouth}
  <path d="M46 114 l-4 8 M52 114 l0 8 M68 114 l0 8 M74 114 l4 8" stroke="#ffb38a" stroke-width="4" stroke-linecap="round"/>
  ${extra}
</svg>`;
}
