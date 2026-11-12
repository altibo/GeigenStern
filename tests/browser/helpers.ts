import type { Page } from "@playwright/test";
import { FAKE_MIC } from "./fakemic.ts";

export async function open(page: Page, opts: { welcomed?: boolean; micOk?: boolean; query?: string } = {}) {
  await page.addInitScript(FAKE_MIC);
  await page.addInitScript(
    ({ welcomed, micOk }) => {
      if (sessionStorage.getItem("gs-init")) return;
      sessionStorage.setItem("gs-init", "1");
      if (welcomed) localStorage.setItem("geigenstern:welcomed", "1");
      if (micOk) localStorage.setItem("geigenstern:v1", JSON.stringify({ micExplained: true }));
    },
    { welcomed: opts.welcomed ?? true, micOk: opts.micOk ?? true },
  );
  await page.goto(`./?nosw${opts.query ?? ""}`);
}
export const view = (page: Page) =>
  page.evaluate(() => (window as unknown as { __gs: { play: { view(): Record<string, unknown> } } }).__gs.play.view()) as Promise<{
    state: string;
    beat: number;
    index: number;
    waiting: boolean;
    score: number;
    combo: number;
    results: number;
    last: { pitch: string; time: string; points: number } | null;
    spb: number;
  }>;
/** collect every feedback text the app shows */
export async function recordFeedback(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __fb: string[] };
    w.__fb = [];
    const el = document.querySelector("[data-testid=feedback]")!;
    new MutationObserver(() => w.__fb.push(el.textContent ?? "")).observe(el, { childList: true, characterData: true, subtree: true });
    const sub = document.querySelector("[data-testid=feedback-sub]")!;
    new MutationObserver(() => w.__fb.push("sub:" + (sub.textContent ?? ""))).observe(sub, { childList: true, characterData: true, subtree: true });
  });
}
export const feedbackLog = (page: Page) => page.evaluate(() => (window as unknown as { __fb: string[] }).__fb);

/** start a song from the list with given speed (skipping the tuner) */
export async function startSong(page: Page, id: string, speed: "normal" | "turtle" | "snail") {
  await page.getByTestId(`song-${id}`).click();
  if (await page.getByTestId("tuner").isVisible().catch(() => false)) await page.getByTestId("tuner-skip").click();
  await page.getByTestId(`speed-${speed}`).click();
}
