import { test, expect, type Page } from "@playwright/test";
test.setTimeout(120000);
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
  const actual = await page.evaluate(() =>
    (window as any).__practice.api.score.tracks[0].staves[0].bars.flatMap((b: any) =>
      b.voices[0].beats.flatMap((beat: any) => beat.notes.map((n: any) => n.realValue)),
    ),
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
  for (const [i, expected] of [0.8, 3, 5.8].entries())
    expect(
      Math.abs(Number(await dialog.locator(`#anchor-${i}`).inputValue()) - expected),
    ).toBeLessThan(0.24);
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
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__practice.state.bar)).toBe(1);
  await expect(page.getByAltText("原始樂譜，第 2 頁")).toBeVisible();
  const clock = await page.evaluate(() => {
    const e = (window as any).__practice;
    return { media: e.audio.currentTime, time: e.state.time, tick: e.state.tick };
  });
  expect(Math.abs(clock.time / 1000 - clock.media)).toBeLessThan(0.12);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
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
