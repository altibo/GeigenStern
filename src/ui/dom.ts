type Attrs = Record<string, string | number | boolean | undefined>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids) if (k !== null && k !== undefined) el.append(k);
  return el;
}
export function btn(label: string | Node, cls: string, onClick: () => void, testid?: string, aria?: string): HTMLButtonElement {
  const b = h("button", { class: cls, type: "button", "data-testid": testid, "aria-label": aria });
  b.append(label);
  b.addEventListener("click", onClick);
  return b;
}
/** segmented control; returns the element and a setter */
export function segmented<T extends string>(opts: { v: T; label: string; testid?: string }[], value: T, onChange: (v: T) => void, cls = "seg") {
  const wrap = h("div", { class: cls, role: "radiogroup" });
  const buttons = opts.map((o) => {
    const parts = o.label.split("\n");
    const label = parts.length > 1 ? h("span", { class: "seg-stack" }, h("span", { class: "seg-ico" }, parts[0]), h("span", {}, parts[1])) : o.label;
    const b = btn(label, "seg-btn", () => {
      set(o.v);
      onChange(o.v);
    }, o.testid);
    b.setAttribute("role", "radio");
    b.dataset.v = o.v;
    wrap.append(b);
    return b;
  });
  const set = (v: T) => buttons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === v)));
  set(value);
  return { el: wrap, set };
}
export const starsText = (n: number) => "★".repeat(n) + "☆".repeat(3 - n);
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function confetti(host: HTMLElement) {
  if (reducedMotion()) return;
  const colors = ["#ffc0cf", "#a9d6ff", "#a8e6c8", "#d4c2ff", "#ffe08a", "#ffd2a8"];
  const layer = h("div", { class: "confetti", "aria-hidden": "true" });
  for (let i = 0; i < 46; i++) {
    const p = h("i");
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 1.2}s`;
    p.style.animationDuration = `${3 + Math.random() * 2}s`;
    p.style.setProperty("--drift", `${(Math.random() - 0.5) * 120}px`);
    p.style.setProperty("--spin", `${(Math.random() - 0.5) * 540}deg`);
    layer.append(p);
  }
  host.append(layer);
  setTimeout(() => layer.remove(), 6500);
}
