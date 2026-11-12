import { test, expect, type Page } from "@playwright/test";
import { FAKE_MIC } from "./fakemic.ts";

const sizes = [
  { w: 390, h: 844 },
  { w: 844, h: 390 },
];
const day = (off: number) => {
  const d = new Date();
  d.setDate(d.getDate() - off);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
async function seed(page: Page) {
  await page.addInitScript(FAKE_MIC);
  await page.addInitScript((days) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("geigenstern:welcomed", "1");
    localStorage.setItem(
      "geigenstern:v1",
      JSON.stringify({
        micExplained: true,
        songs: { entchen: { stars: 3, best: 2480, plays: 4 }, haenschen: { stars: 2, best: 3120, plays: 2 }, ode: { stars: 1, best: 2010, plays: 1 } },
        days,
        badges: ["first", "three", "streak3"],
        perfectTotal: 64,
      }),
    );
  }, [day(2), day(1), day(0)]);
}

for (const { w, h } of sizes) {
  test(`screenshots ${w}x${h}`, async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: w, height: h });
    await seed(page);
    await page.goto("./?nosw");
    await expect(page.getByTestId("greeting")).toHaveText("Hallo Liviana!");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `shots/home-${w}x${h}.png` });

    // tuner with an in-tune A string
    await page.getByTestId("song-hedwig").click();
    await expect(page.getByTestId("tuner")).toBeVisible();
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as unknown as { __fakeMic: { tone(m: number, d: number, a: number, c: number): void } }).__fakeMic.tone(69, 3, 0, 3));
    await expect(page.getByTestId("tstr-A")).toHaveClass(/done/, { timeout: 4000 });
    await page.screenshot({ path: `shots/tuner-${w}x${h}.png` });
    await page.getByTestId("tuner-next").click();
    await expect(page.getByTestId("ready")).toBeVisible();
    await page.getByTestId("speed-turtle").click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `shots/ready-${w}x${h}.png` });

    // play, all three modes (auto-player plays the right notes)
    await page.evaluate(() => (window as unknown as { __fakeMic: { startFollow(o: object): void } }).__fakeMic.startFollow({}));
    await page.getByTestId("start").click();
    await page.waitForFunction(() => (window as unknown as { __gs: { play: { view(): { index: number } } } }).__gs.play.view().index >= 4, null, { timeout: 30000 });
    for (const m of ["tabs", "both", "notes"]) {
      await page.getByTestId(`mode-${m}`).click();
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `shots/play-${m}-${w}x${h}.png` });
    }
    await expect(page.getByTestId("results")).toBeVisible({ timeout: 120000 });
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `shots/results-${w}x${h}.png` });
  });
}
