import { test, expect } from "@playwright/test";

test("real two-page PDF and WAV: manual alignment, media clock, page following, seek, speed and persistence", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled({
    timeout: 30000,
  });
  const menu = page.getByRole("button", { name: "開啟我的樂譜", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
  await page
    .getByLabel("選擇樂譜檔案", { exact: true })
    .setInputFiles("tests/fixtures/tab/cross-page-ties.pdf");
  await page.getByRole("button", { name: "只標記小節，使用節拍引導" }).click();
  const dialog = page.getByRole("dialog");
  async function mark() {
    const image = dialog.locator(".reference-image");
    await expect(image.locator("img")).toBeVisible();
    await image.scrollIntoViewIfNeeded();
    const b = (await image.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.6, { steps: 6 });
    await page.mouse.up();
  }
  await mark();
  await dialog.getByRole("button", { name: "下一頁原譜" }).click();
  await expect(dialog.getByAltText("原始樂譜，第 2 頁")).toBeVisible();
  await mark();
  await dialog.getByRole("button", { name: "確認並開始練習" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "配對音檔", exact: true }).click();
  await dialog.locator("input[type=file]").setInputFiles("tests/fixtures/test-tone.wav");
  await expect(dialog.getByText("長度 12.00 秒")).toBeVisible();
  await expect(dialog.locator(".reference-image img")).toBeVisible();
  // Capture a genuine media seek using the new tap-to-mark control.
  await dialog.locator("audio").evaluate(async (el: HTMLAudioElement) => {
    await new Promise<void>((resolve) => {
      el.addEventListener("seeked", () => resolve(), { once: true });
      el.currentTime = 1;
    });
  });
  await dialog.getByRole("button", { name: "記下目前時間並到下一小節" }).click();
  await expect(dialog.locator("#anchor-0")).toHaveValue("1");
  // Deliberately uneven durations prove this is anchor mapping, not fixed scrolling.
  await dialog.locator("#anchor-1").fill("3");
  await dialog.locator("#anchor-2").fill("2");
  await dialog.getByLabel("我已聽過並校正這些時間點").check();
  await expect(dialog.getByRole("button", { name: "保存時間對齊" })).toBeDisabled();
  await dialog.locator("#anchor-2").fill("7");
  await dialog.getByLabel("我已聽過並校正這些時間點").check();
  await dialog.getByRole("button", { name: "保存時間對齊" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("播放模式", { exact: true })).toHaveValue("audio");
  await page.evaluate(async () => {
    const e = (window as any).__practice,
      c = new AudioContext(),
      a = c.createAnalyser();
    c.createMediaElementSource(e.audio).connect(a);
    a.connect(c.destination);
    await c.resume();
    (window as any).__recordingMeter = { c, a };
  });
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { a } = (window as any).__recordingMeter;
        const d = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(d);
        return Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);
      }),
    )
    .toBeGreaterThan(0.001);
  await expect.poll(() => page.evaluate(() => (window as any).__practice.state.bar)).toBe(1);
  await expect(page.getByAltText("原始樂譜，第 2 頁")).toBeVisible();
  const sample = await page.evaluate(() => {
    const e = (window as any).__practice;
    return {
      tick: e.state.tick,
      time: e.state.time,
      media: e.audio.currentTime,
      bar: e.state.bar,
      synth: e.api.playerState,
      pitch: e.audio.preservesPitch,
    };
  });
  expect(sample.bar).toBe(1);
  expect(sample.synth).toBe(0);
  expect(sample.pitch).toBe(true);
  expect(Math.abs(sample.time / 1000 - sample.media)).toBeLessThan(0.12);
  expect(Math.abs(sample.tick - (3840 + (sample.media - 3) * 960))).toBeLessThan(150);
  await expect(page.locator(".reference-marker.active")).toHaveAttribute(
    "aria-label",
    "原譜第 2 小節",
  );
  await expect(page.locator(".reference-playhead")).toBeVisible();
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  const stopped = await page.evaluate(() => (window as any).__practice.state.tick);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__practice.state.tick)).toBe(stopped);
  await page.getByRole("button", { name: "上一頁原譜" }).click();
  await page.getByRole("button", { name: "原譜第 1 小節", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__practice.audio.currentTime))
    .toBeCloseTo(1, 1);
  await page.getByLabel("播放速度", { exact: true }).selectOption("0.5");
  expect(await page.evaluate(() => (window as any).__practice.audio.playbackRate)).toBe(0.5);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__practice.audio.currentTime))
    .toBeGreaterThan(1.2);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  const resume = await page.evaluate(() => (window as any).__practice.audio.currentTime);
  await page.waitForTimeout(900); // debounced practice position persistence
  await page.reload();
  await expect(page.getByLabel("播放模式", { exact: true })).toHaveValue("audio");
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => (window as any).__practice.audio.currentTime))
    .toBeCloseTo(resume, 1);
  await expect(page.locator(".reference-image img")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: `artifacts/pdf-audio-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "校對與標記", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "只標記小節，使用節拍引導" }).click();
  await dialog.getByRole("button", { name: "確認並開始練習" }).click();
  await expect(dialog).toBeHidden();
  // Reconfirmed reference invalidates the old recording mapping rather than silently reusing it.
  await expect(page.getByLabel("播放模式", { exact: true })).toHaveValue("synth");
  await expect(
    page.getByLabel("播放模式", { exact: true }).locator('option[value="audio"]'),
  ).toHaveCount(0);
});
