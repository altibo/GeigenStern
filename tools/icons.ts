// Renders the app icons from the owl SVG (run: node tools/icons.ts)
import { chromium } from "@playwright/test";
import { owlSvg } from "../src/ui/owl.ts";
const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0"><div style="width:${size}px;height:${size}px;background:radial-gradient(circle at 50% 40%,#fff5fa,#d4c2ff);display:grid;place-items:center">
  <div style="position:relative">${owlSvg("happy", Math.round(size * 0.62))}
  <div style="position:absolute;right:${-size * 0.06}px;top:${-size * 0.04}px;font-size:${size * 0.2}px;color:#f6c344;text-shadow:0 2px 0 #e0a93a">★</div></div></div></body></html>`);
  await page.screenshot({ path: `public/icon-${size}.png` });
}
await browser.close();
