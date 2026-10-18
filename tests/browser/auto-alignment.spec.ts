import { test, expect, type Page } from "@playwright/test";
import { model } from "@coderline/alphatab";
import { writeFileSync } from "node:fs";
test.setTimeout(120000);
// Observe genuine native media elements without depending on the development-only engine hook.
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    (window as any).__nativeRecordings = [];
    const NativeAudio = window.Audio;
    window.Audio = new Proxy(NativeAudio, {
      construct(target, args) {
        const audio = Reflect.construct(target, args) as HTMLAudioElement;
        (window as any).__nativeRecordings.push(audio);
        return audio;
      },
    });
  });
});
async function mediaState(page: Page) {
  return page.evaluate(() => {
    const audio = (window as any).__nativeRecordings.at(-1) as HTMLAudioElement;
    return {
      time: audio.currentTime,
      paused: audio.paused,
      seeking: audio.seeking,
      ready: audio.readyState,
      rate: audio.playbackRate,
      pitch: audio.preservesPitch,
      progress: Number(document.querySelector<HTMLInputElement>('[aria-label="播放進度"]')?.value),
      wall: performance.now(),
    };
  });
}
async function savedPiece(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("string-space-library", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const all = await new Promise<any[]>((resolve, reject) => {
      const r = db.transaction("pieces").objectStore("pieces").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return all.find((p) => p.sourceName === "two-page-study.pdf");
  });
}
async function uploadAndRecognize(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled({
    timeout: 30000,
  });
  const menu = page.getByRole("button", { name: "開啟我的樂譜", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
  await page
    .getByLabel("選擇樂譜檔案", { exact: true })
    .setInputFiles("tests/fixtures/alignment/two-page-study.pdf");
  await page.getByLabel("辨識譜面類型").selectOption("tab");
  await page.getByLabel("辨識 PDF 頁碼", { exact: true }).fill("1-2");
  await page.getByRole("button", { name: "辨識六線譜弦品", exact: true }).click();
  await expect(page.getByLabel("校對小節與聲部")).toBeVisible({ timeout: 90000 });
  await page.getByLabel("校對速度 BPM").fill("120");
  await page.getByLabel("確認調弦與 Capo", { exact: true }).check();
  for (const bar of ["0", "1"]) {
    await page.getByLabel("校對小節與聲部").selectOption(bar);
    await page.getByLabel("確認六線譜節奏", { exact: true }).check();
    await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
  }
  await page.getByRole("button", { name: "確認全部，合成播放", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
}
test("automatic PDF + real WAV: no typed timestamps, nonuniform anchors, original-page preview, correction and persistence", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && !["localhost", "127.0.0.1"].includes(new URL(r.url()).hostname))
      external.push(r.url());
  });
  await uploadAndRecognize(page);
  const piece = await savedPiece(page);
  const score = model.JsonConverter.jsonToScore(piece.scoreJson);
  const actual = score.tracks[0].staves[0].bars.flatMap((b) =>
    b.voices[0].beats.flatMap((beat) => beat.notes.map((n) => n.realValue)),
  );
  expect(actual).toEqual([64, 67, 71, 66, 69, 65, 72, 70]);
  await page.getByRole("button", { name: "配對音檔", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/alignment/uneven-performance.wav");
  await expect(dialog.getByText("長度 7.00 秒")).toBeVisible();
  await dialog.getByRole("button", { name: "自動分析並對齊音檔", exact: true }).click();
  await expect(dialog.getByTestId("alignment-result")).toBeVisible({ timeout: 30000 });
  const automaticAnchors = [];
  for (const [i, expected] of [0.8, 3, 5.8].entries()) {
    const value = Number(await dialog.locator(`#anchor-${i}`).inputValue());
    automaticAnchors.push(value);
    expect(Math.abs(value - expected)).toBeLessThan(0.24);
  }
  await expect(dialog.getByRole("button", { name: "保存時間對齊", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "預覽自動跟譜", exact: true }).click();
  await expect(dialog.getByAltText("原始樂譜，第 2 頁")).toBeVisible({ timeout: 12000 });
  await expect(dialog.locator(".reference-marker.active")).toBeInViewport({ ratio: 0.5 });
  await dialog.locator("audio").evaluate((el: HTMLAudioElement) => el.pause());
  await dialog.locator("#anchor-1").fill("3.04");
  await expect(dialog.getByText("已人工修改 1 個時間點，請再次試聽。")).toBeVisible();
  await dialog.getByLabel("我已聽過並校正這些時間點").check();
  await dialog.getByRole("button", { name: "保存時間對齊", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("播放模式", { exact: true })).toHaveValue("audio");
  await expect(page.getByAltText("原始樂譜，第 1 頁")).toBeVisible();
  await page.evaluate(async () => {
    const audio = (window as any).__nativeRecordings.at(-1) as HTMLAudioElement;
    const c = new AudioContext(),
      a = c.createAnalyser();
    c.createMediaElementSource(audio).connect(a);
    a.connect(c.destination);
    await c.resume();
    (window as any).__recordingMeter = { c, a };
  });
  const rms = () =>
    page.evaluate(() => {
      const a = (window as any).__recordingMeter.a as AnalyserNode,
        d = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(d);
      return Math.sqrt(d.reduce((sum, v) => sum + v * v, 0) / d.length);
    });
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(rms).toBeGreaterThan(0.001);
  const audibleRms = await rms();
  await expect(page.getByTestId("bar-label")).toContainText("第 2 / 2 小節");
  await expect(page.getByAltText("原始樂譜，第 2 頁")).toBeVisible();
  await expect(page.locator(".reference-marker.active")).toHaveAttribute(
    "aria-label",
    "原譜第 2 小節",
  );
  const clock = await mediaState(page);
  expect(Math.abs(clock.progress / 1000 - clock.time)).toBeLessThan(0.12);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  const stopped = await mediaState(page);
  expect(stopped.paused).toBe(true);
  await page.waitForTimeout(350);
  const still = await mediaState(page);
  expect(still.time).toBe(stopped.time);
  expect(still.progress).toBe(stopped.progress);
  // The waveform meter reroutes media through Web Audio. Restore a fresh native
  // output through the app's real pairing UI before measuring rate/loop behavior.
  // In WebKit this also avoids attributing analyzer startup buffering to the app.
  const beforePair = await page.evaluate(() => (window as any).__nativeRecordings.length);
  await page.evaluate(async () => {
    await (window as any).__recordingMeter.c.close();
  });
  await page.getByRole("button", { name: "配對音檔", exact: true }).click();
  await expect(dialog.locator("#anchor-1")).toHaveValue("3.04");
  await dialog.getByLabel("我已聽過並校正這些時間點").check();
  await dialog.getByRole("button", { name: "保存時間對齊", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (window as any).__nativeRecordings.length))
    .toBeGreaterThan(beforePair);

  const previousPage = page.getByRole("button", { name: "上一頁原譜", exact: true });
  if (await previousPage.isEnabled()) await previousPage.click();
  await page.getByRole("button", { name: "原譜第 1 小節", exact: true }).click();
  await expect.poll(async () => (await mediaState(page)).time).toBeCloseTo(automaticAnchors[0], 1);
  await expect(page.getByTestId("bar-label")).toContainText("第 1 / 2 小節");
  await page.getByLabel("播放速度", { exact: true }).selectOption("0.5");
  expect((await mediaState(page)).rate).toBe(0.5);
  expect((await mediaState(page)).pitch).toBe(true);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  // Native media may buffer after a seek/rate change. Measure steady playback,
  // after the real media clock has advanced, instead of including startup latency.
  await expect.poll(async () => (await mediaState(page)).seeking).toBe(false);
  await expect
    .poll(async () => (await mediaState(page)).time)
    .toBeGreaterThan(automaticAnchors[0] + 0.2);
  const start = await mediaState(page);
  await page.waitForTimeout(1000);
  const half = await mediaState(page);
  const halfSpeedRatio = (half.time - start.time) / ((half.wall - start.wall) / 1000);
  expect(halfSpeedRatio).toBeGreaterThan(0.4);
  expect(halfSpeedRatio).toBeLessThan(0.6);
  expect(Math.abs(half.progress / 1000 - half.time)).toBeLessThan(0.12);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await page.getByLabel("播放速度", { exact: true }).selectOption("1.5");
  await page.getByRole("button", { name: "A–B 循環", exact: true }).click();
  await page.getByLabel("循環起始小節").selectOption("2");
  await page.getByLabel("循環結束小節").selectOption("2");
  await page.getByRole("button", { name: "開始循環練習", exact: true }).click();
  await page.evaluate(() => {
    const a = (window as any).__nativeRecordings.at(-1) as HTMLAudioElement;
    (window as any).__recordingReturns = 0;
    a.addEventListener("seeked", () => {
      if (Math.abs(a.currentTime - 3.04) < 0.15) (window as any).__recordingReturns++;
    });
  });
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__recordingReturns), { timeout: 15000 })
    .toBeGreaterThanOrEqual(3);
  await expect(page.getByRole("button", { name: "暫停", exact: true })).toBeVisible();
  await expect(page.getByTestId("bar-label")).toContainText("第 2 / 2 小節");
  const loopClock = await mediaState(page);
  expect(Math.abs(loopClock.progress / 1000 - loopClock.time)).toBeLessThan(0.12);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await page.getByRole("button", { name: "2–2 循環", exact: true }).click();
  await page.getByRole("button", { name: "關閉循環", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("播放模式", { exact: true })).toHaveValue("audio");
  await page.getByRole("button", { name: "配對音檔", exact: true }).click();
  await expect(dialog.getByTestId("alignment-result")).toBeVisible();
  await expect(dialog.locator("#anchor-1")).toHaveValue("3.04");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: `artifacts/auto-alignment-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(external).toEqual([]);
  const metrics = {
    date: new Date().toISOString(),
    url: page.url(),
    browser: test.info().project.name,
    automaticAnchors,
    expectedAnchors: [0.8, 3, 5.8],
    audibleRms,
    clockDifferenceSeconds: Math.abs(clock.progress / 1000 - clock.time),
    halfSpeedRatio,
    loopClockDifferenceSeconds: Math.abs(loopClock.progress / 1000 - loopClock.time),
    passed: true,
  };
  writeFileSync(
    `artifacts/auto-alignment-verification-${test.info().project.name}.json`,
    JSON.stringify(metrics, null, 2),
  );
});
test("unrelated recording is rejected without overwriting manual anchors", async ({ page }) => {
  await uploadAndRecognize(page);
  await page.getByRole("button", { name: "配對音檔", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=file]").setInputFiles("tests/fixtures/alignment/unrelated.wav");
  await expect(dialog.getByText("長度 7.00 秒")).toBeVisible();
  await dialog.locator("#anchor-0").fill("0.2");
  await dialog.getByRole("button", { name: "自動分析並對齊音檔", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("相似度不足", { timeout: 30000 });
  await expect(dialog.locator("#anchor-0")).toHaveValue("0.2");
  await expect(dialog.getByTestId("alignment-result")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存時間對齊", exact: true })).toBeDisabled();
});
