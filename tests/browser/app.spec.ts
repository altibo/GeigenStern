import { test, expect } from "@playwright/test";
import { SONGS } from "../../src/core/songs.ts";
import { renderMelody } from "../../tools/wav.ts";
import { feedbackLog, open, recordFeedback, startSong, view } from "./helpers.ts";

const entchen = SONGS[0];
const correctWav = renderMelody(entchen, entchen.bpm);
// first 4 notes 55 cents flat, the rest a minor third too high
const wrongWav = renderMelody(entchen, entchen.bpm, (i) => (i < 4 ? [0, -55] : [3, 0]));

async function playWav(page: import("@playwright/test").Page, url: string) {
  await page.getByTestId("start").click();
  await page.waitForFunction(() => (window as unknown as { __gs: { play: { view(): { state: string } } } }).__gs.play.view().state === "countin");
  const perf0 = await page.evaluate(() => (window as unknown as { __gs: { play: { perfOfBeat(b: number): number } } }).__gs.play.perfOfBeat(0));
  await page.evaluate(([u, t]) => (window as unknown as { __fakeMic: { wav(u: string, t: number): Promise<void> } }).__fakeMic.wav(u as string, t as number), [url, perf0]);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/__test/correct.wav", (r) => r.fulfill({ body: correctWav, contentType: "audio/wav" }));
  await page.route("**/__test/wrong.wav", (r) => r.fulfill({ body: wrongWav, contentType: "audio/wav" }));
});

test("first start: greeting with prefilled name Liviana, name editable, 5 songs easy->hard", async ({ page }) => {
  await open(page, { welcomed: false, micOk: false });
  await expect(page.getByTestId("welcome")).toBeVisible();
  await expect(page.getByTestId("welcome-name")).toHaveValue("Liviana");
  await page.getByTestId("welcome-ok").click();
  await expect(page.getByTestId("greeting")).toHaveText("Hallo Liviana!");
  const titles = await page.locator(".song-title").allTextContents();
  expect(titles).toEqual(["Alle meine Entchen", "Hänschen klein", "Ode an die Freude", "Twinkle Twinkle Little Star", "Harry-Potter-Thema"]);
  await expect(page.getByTestId("stars-entchen")).toHaveText("☆☆☆");
  await page.getByTestId("edit-name").click();
  await page.getByTestId("name-input").fill("Livi");
  await page.getByTestId("name-ok").click();
  await expect(page.getByTestId("greeting")).toHaveText("Hallo Livi!");
  await page.reload();
  await expect(page.getByTestId("greeting")).toHaveText("Hallo Livi!");
  await expect(page.getByTestId("welcome")).toHaveCount(0);
});

test("tuner: mic explanation, then A string in tune -> 'passt!', D string flat -> 'zu tief'", async ({ page }) => {
  await open(page, { micOk: false });
  await page.getByTestId("open-tuner").click();
  await expect(page.getByTestId("mic-explain")).toContainText("Darf ich zuhören?");
  await page.getByTestId("mic-ok").click();
  await expect(page.getByTestId("tuner")).toBeVisible();
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as unknown as { __fakeMic: { tone(m: number, d: number, a: number, c: number): void } }).__fakeMic.tone(69, 2.5, 0, 4));
  await expect(page.getByTestId("tuner-msg")).toHaveText("passt!", { timeout: 3000 });
  await expect(page.getByTestId("tstr-A")).toHaveClass(/done/, { timeout: 3000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => (window as unknown as { __fakeMic: { tone(m: number, d: number, a: number, c: number): void } }).__fakeMic.tone(62, 2, 0, -30));
  await expect(page.getByTestId("tuner-msg")).toContainText("zu tief", { timeout: 3000 });
  await expect(page.getByTestId("tuner-note")).toContainText("D");
  await expect(page.getByTestId("tstr-D")).not.toHaveClass(/done/);
  await page.getByTestId("tuner-close").click();
  await expect(page.getByTestId("home")).toBeVisible();
});

test("song before play opens the tuner first (skippable)", async ({ page }) => {
  await open(page);
  await page.getByTestId("song-entchen").click();
  await expect(page.getByTestId("tuner")).toBeVisible();
  await page.getByTestId("tuner-skip").click();
  await expect(page.getByTestId("ready")).toBeVisible();
});

test("normal speed, correct melody WAV -> Super feedback, 3 stars, saved and shown in the list; wrong WAV -> zu tief / zu hoch, 0 stars, best kept", async ({ page }) => {
  await open(page, { query: "&notuner" });
  await startSong(page, "entchen", "normal");
  await recordFeedback(page);
  await playWav(page, "/__test/correct.wav");
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 60000 });
  const log = await feedbackLog(page).catch(() => [] as string[]);
  expect(log.filter((t) => t === "Super!").length).toBeGreaterThan(5);
  await expect(page.getByTestId("result-stars")).toHaveAttribute("aria-label", "3 von 3 Sternen");
  const score = Number(await page.getByTestId("result-score").textContent());
  expect(score).toBeGreaterThan(2000);
  await expect(page.getByTestId("new-best")).toBeVisible();
  await expect(page.getByTestId("new-badges")).toContainText("Erstes Lied");
  await page.getByTestId("to-home").click();
  await expect(page.getByTestId("stars-entchen")).toHaveText("★★★");
  await expect(page.getByTestId("best-entchen")).toHaveText(`Bestwert ${score}`);
  await expect(page.getByTestId("badge-first")).toHaveClass(/got/);
  await expect(page.getByTestId("streak")).toContainText("1 Tag");

  // wrong notes
  await startSong(page, "entchen", "normal");
  await recordFeedback(page);
  await playWav(page, "/__test/wrong.wav");
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("result-stars")).toHaveAttribute("aria-label", "0 von 3 Sternen");
  await page.getByTestId("to-home").click();
  await expect(page.getByTestId("stars-entchen")).toHaveText("★★★");
  await expect(page.getByTestId("best-entchen")).toHaveText(`Bestwert ${score}`);
  await page.reload();
  await expect(page.getByTestId("stars-entchen")).toHaveText("★★★");
});

test("wrong-note feedback texts during play", async ({ page }) => {
  await open(page, { query: "&notuner" });
  await startSong(page, "entchen", "normal");
  await recordFeedback(page);
  await playWav(page, "/__test/wrong.wav");
  await page.waitForFunction(() => (window as unknown as { __gs: { play: { view(): { results: number } } } }).__gs.play.view().results >= 8, null, { timeout: 30000 });
  const log = await feedbackLog(page);
  expect(log).toContain("etwas zu tief");
  expect(log).toContain("zu hoch – anderer Ton");
  expect(log).not.toContain("Super!");
});

test("Schnecke: waits for the right note (clock frozen, backing keeps sounding), live hint on a wrong note, then continues", async ({ page }) => {
  await open(page, { query: "&notuner" });
  await startSong(page, "entchen", "snail");
  await page.getByTestId("start").click();
  // tap the backing bus to prove the band keeps playing while waiting
  await page.evaluate(() => {
    const gs = (window as unknown as { __gs: { audio: { ctx: AudioContext; backingBus: GainNode } } }).__gs;
    const an = gs.audio.ctx.createAnalyser();
    an.fftSize = 2048;
    gs.audio.backingBus.connect(an);
    (window as unknown as { __an: AnalyserNode }).__an = an;
  });
  await page.waitForFunction(() => (window as unknown as { __gs: { play: { view(): { waiting: boolean } } } }).__gs.play.view().waiting, null, { timeout: 15000 });
  const v1 = await view(page);
  expect(v1.index).toBe(0);
  expect(v1.beat).toBeGreaterThan(0);
  expect(v1.beat).toBeLessThanOrEqual(0.35);
  await expect(page.getByTestId("hint")).toHaveText("Spiele: D · D-Saite · leere Saite");
  await expect(page.getByTestId("owl-say")).toContainText("Ich warte auf dich");
  await page.waitForTimeout(1500);
  const v2 = await view(page);
  expect(v2.beat).toBe(v1.beat);
  const level = await page.evaluate(() => {
    const an = (window as unknown as { __an: AnalyserNode }).__an;
    const d = new Float32Array(2048);
    an.getFloatTimeDomainData(d);
    return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
  });
  expect(level).toBeGreaterThan(0.001);
  // wrong note (E instead of D): still waiting, hint says too high
  await page.evaluate(() => (window as unknown as { __fakeMic: { tone(m: number, d: number, a: number, c: number): void } }).__fakeMic.tone(64, 1.2, 0, 0));
  await expect(page.getByTestId("owl-say")).toContainText("zu hoch", { timeout: 2000 });
  expect((await view(page)).index).toBe(0);
  await page.waitForTimeout(1300);
  // now the auto-player plays the right notes
  await page.evaluate(() => (window as unknown as { __fakeMic: { startFollow(o: object): void } }).__fakeMic.startFollow({}));
  await page.waitForFunction(() => (window as unknown as { __gs: { play: { view(): { index: number } } } }).__gs.play.view().index >= 6, null, { timeout: 30000 });
  const v3 = await view(page);
  expect(v3.score).toBeGreaterThan(400);
  expect(v3.last?.pitch).toBe("super");
  await page.getByTestId("pause").click();
  await expect(page.getByTestId("resume")).toBeVisible();
  await page.getByTestId("to-list").click();
  await expect(page.getByTestId("home")).toBeVisible();
});

test("Schildkröte runs at 70 % tempo, Schnecke at 50 %", async ({ page }) => {
  await open(page, { query: "&notuner" });
  await startSong(page, "ode", "turtle");
  await page.getByTestId("start").click();
  await page.waitForFunction(() => (window as unknown as { __gs: { play: { view(): { state: string } } } }).__gs.play.view().state === "countin");
  expect((await view(page)).spb).toBeCloseTo(60 / (100 * 0.7), 5);
  await page.getByTestId("exit").click();
  await startSong(page, "ode", "snail");
  await page.getByTestId("start").click();
  expect((await view(page)).spb).toBeCloseTo(60 / 50, 5);
});

test("display modes: Tabs, Tabs + Noten, Noten", async ({ page }) => {
  await open(page, { query: "&notuner" });
  await startSong(page, "twinkle", "normal");
  const strip = page.getByTestId("strip");
  await page.getByTestId("mode-tabs").click();
  await expect(strip).toHaveAttribute("data-mode", "tabs");
  expect(await page.locator(".strip .tabnote").count()).toBe(42);
  expect(await page.locator(".strip .head").count()).toBe(0);
  await expect(page.locator(".strip .finger").first()).toHaveText("0");
  await page.getByTestId("mode-both").click();
  await expect(strip).toHaveAttribute("data-mode", "both");
  expect(await page.locator(".strip .tabnote").count()).toBe(42);
  expect(await page.locator(".strip .head").count()).toBe(42);
  await page.getByTestId("mode-notes").click();
  await expect(strip).toHaveAttribute("data-mode", "notes");
  expect(await page.locator(".strip .tabnote").count()).toBe(0);
  expect(await page.locator(".strip .head").count()).toBe(42);
  await page.reload();
  await startSong(page, "twinkle", "normal");
  await expect(page.getByTestId("strip")).toHaveAttribute("data-mode", "notes");
});

test("practice a passage until it works; worst-bars suggestion after a run", async ({ page }) => {
  await open(page, { query: "&notuner" });
  await startSong(page, "haenschen", "normal");
  // bars 2-2 only
  await page.getByTestId("pr-from-plus").click();
  await expect(page.getByTestId("pr-from")).toHaveText("2");
  await expect(page.getByTestId("pr-to")).toHaveText("2");
  await page.evaluate(() => (window as unknown as { __fakeMic: { startFollow(o: object): void } }).__fakeMic.startFollow({}));
  await page.getByTestId("practice").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".res-title")).toHaveText("Geschafft! Takt 2–2 sitzt.");
  // a run with the first notes skipped suggests bars 1-2
  await page.getByTestId("to-home").click();
  await startSong(page, "entchen", "normal");
  await page.evaluate(() => (window as unknown as { __fakeMic: { startFollow(o: object): void } }).__fakeMic.startFollow({ skip: [0, 1, 2, 3, 4] }));
  await page.getByTestId("start").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("practice-worst")).toHaveText("🎯 Takt 1–2 üben");
  await page.getByTestId("practice-worst").click();
  await expect(page.getByTestId("pr-from")).toHaveText("1");
  await expect(page.getByTestId("pr-to")).toHaveText("2");
});

test("Anhören plays the song without the microphone and returns to the start panel", async ({ page }) => {
  await open(page, { query: "&notuner" });
  await startSong(page, "entchen", "normal");
  await page.getByTestId("preview").click();
  await page.waitForFunction(() => (window as unknown as { __gs: { play: { view(): { state: string } } } }).__gs.play.view().state === "running", null, { timeout: 5000 });
  await expect(page.getByTestId("hint")).toContainText("Anhören");
  await expect(page.getByTestId("ready")).toBeVisible({ timeout: 40000 });
});
