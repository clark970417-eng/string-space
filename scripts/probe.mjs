import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(m.type(), m.text().slice(0, 500));
});
await page.goto("http://localhost:5178");
await page.waitForTimeout(4000);
console.log((await page.locator("body").innerText()).slice(0, 5000));
console.log(
  await page.evaluate(() => ({
    engine: !!window.__practice,
    score: window.__practice?.api.score?.title,
    state: window.__practice?.state,
    bounds: document.querySelectorAll("[data-bar]").length,
    svg: document.querySelectorAll(".score-canvas svg").length,
  })),
);
await page.screenshot({ path: "artifacts/desktop-initial.png", fullPage: true });
await browser.close();
