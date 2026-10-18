import { chromium, webkit, devices, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const baseURL = process.env.PRACTICE_PREVIEW_URL || "http://localhost:4178";
await mkdir("artifacts", { recursive: true });
const results = [];
for (const [name, engine, options] of [
  ["chromium", chromium, { viewport: { width: 1440, height: 1000 } }],
  ["webkit", webkit, { ...devices["iPhone 13"] }],
]) {
  if (process.env.PRACTICE_SMOKE_BROWSER && process.env.PRACTICE_SMOKE_BROWSER !== name) continue;
  const browser = await engine.launch({
    args:
      name === "chromium" && process.env.PRACTICE_SILENT_SINK === "1"
        ? ["--disable-audio-output"]
        : [],
  });
  try {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [],
      external = [],
      failed = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (r) => {
      if (/^https?:/.test(r.url()) && new URL(r.url()).hostname !== new URL(baseURL).hostname)
        external.push(r.url());
    });
    page.on("response", (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    await page.addInitScript(() => {
      window.__outputMeters = [];
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...rest) {
        if (destination instanceof AudioDestinationNode && !(this instanceof AnalyserNode)) {
          const analyser = this.context.createAnalyser();
          analyser.fftSize = 2048;
          window.__outputMeters.push(analyser);
          connect.call(this, analyser);
          connect.call(analyser, destination);
          return destination;
        }
        return connect.call(this, destination, ...rest);
      };
    });
    const rms = () =>
      page.evaluate(() =>
        Math.max(
          0,
          ...window.__outputMeters.map((a) => {
            const samples = new Float32Array(a.fftSize);
            a.getFloatTimeDomainData(samples);
            return Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
          }),
        ),
      );
    await page.goto(baseURL);
    await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled({
      timeout: 20000,
    });
    await expect(page.locator("[data-bar]")).toHaveCount(16);
    await page.getByRole("button", { name: "預備拍", exact: true }).click();
    if (name === "webkit")
      await page.getByRole("button", { name: "專注練習", exact: true }).click();
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await expect.poll(rms, { timeout: 15000 }).toBeGreaterThan(0.001);
    await expect(page.getByTestId("clock")).not.toHaveText("0:00 / 0:48");
    await page.getByRole("button", { name: "暫停", exact: true }).click();
    await expect.poll(rms).toBeLessThan(0.001);
    await page.getByRole("button", { name: "跳到第 5 小節", exact: true }).click();
    await expect(page.getByTestId("bar-label")).toContainText("第 5 / 16");
    await page.getByLabel("播放速度", { exact: true }).selectOption("0.5");
    await expect(page.getByTestId("clock")).toContainText("1:36");
    await page.getByLabel("播放速度", { exact: true }).selectOption("1");
    await page.getByRole("button", { name: "回到開頭", exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `artifacts/production-${name}.png` });
    if (name === "chromium") {
      await page
        .locator(".sheet-paper")
        .screenshot({ path: "tests/fixtures/original-sheet.jpg", type: "jpeg", quality: 85 });
      for (const file of ["original-sheet.jpg", "original-sheet.pdf"]) {
        await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
        await page
          .getByLabel("選擇樂譜檔案", { exact: true })
          .setInputFiles(`tests/fixtures/${file}`);
        await expect(page.locator(".reference-image img")).toBeVisible({ timeout: 20000 });
        await page.getByRole("button", { name: "保存原譜，稍後標記" }).click();
        await expect(page.getByRole("button", { name: "播放", exact: true })).toBeDisabled();
      }
      await page.getByRole("button", { name: "我的樂譜", exact: false }).first().click();
      await expect(page.locator(".library-piece")).toHaveCount(3);
      await expect(page.locator(".piece-thumbnail img")).toHaveCount(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    expect(failed).toEqual([]);
    results.push({
      engine: name,
      passed: true,
      externalRequests: external.length,
      pageErrors: errors.length,
      httpErrors: failed.length,
    });
    console.log(`${name}: production audio, cursor, seeking, speed, assets and layout passed`);
  } finally {
    await browser.close();
  }
}
await writeFile(
  "artifacts/production-smoke.json",
  JSON.stringify({ date: new Date().toISOString(), baseURL, results }, null, 2),
);
