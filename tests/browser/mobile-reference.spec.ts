import { test, expect, devices } from "@playwright/test";
import { existsSync } from "node:fs";
const fixture = (name: string) => `tests/fixtures/${name}`;
async function ready(page: any) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
}
test("portrait reflows notation and controls remain usable; landscape and focus work", async ({
  browser,
}) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    defaultBrowserType: undefined,
  } as any);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await expect(page.locator("[data-bar]")).toHaveCount(16);
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: innerWidth,
    bar: document.querySelector("[data-bar]")!.getBoundingClientRect().width,
  }));
  expect(widths.page).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.bar).toBeGreaterThan(260);
  const play = page.getByRole("button", { name: "播放", exact: true });
  expect((await play.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "專注練習", exact: true }).click();
  await expect(page.locator(".app-header")).toBeHidden();
  await page.getByRole("button", { name: "預備拍", exact: true }).click();
  await play.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__practice.state.tick))
    .toBeGreaterThan(800);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await page.screenshot({ path: "artifacts/mobile-focus.png" });
  await page.getByRole("button", { name: "退出專注", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/mobile.png" });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole("button", { name: "跳到第 16 小節", exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const last = await page.locator('[data-bar="16"]').boundingBox();
  const footer = await page.locator(".transport").boundingBox();
  expect(last!.y + last!.height).toBeLessThan(footer!.y);
  expect(errors).toEqual([]);
  await context.close();
});
test("PNG manual marking keeps original visible and only generates metronome guidance", async ({
  page,
}) => {
  await ready(page);
  await page.locator(".sheet-paper").screenshot({ path: fixture("original-sheet.png") });
  await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
  await page
    .getByLabel("選擇樂譜檔案", { exact: true })
    .setInputFiles(fixture("original-sheet.png"));
  await page.getByRole("button", { name: "只標記小節，使用節拍引導" }).click();
  await expect(page.getByText("尚未辨識音符，無法合成原譜旋律。")).toBeVisible();
  const image = page.locator(".reference-image");
  await expect(image.locator("img")).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  const box = (await image.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.23, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "原譜第 1 小節", exact: true })).toBeAttached();
  await page.getByRole("button", { name: "確認並開始練習" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await expect(page.getByLabel("播放模式", { exact: true })).toHaveValue("synth");
  expect(
    await page.evaluate(() =>
      (window as any).__practice.api.score.tracks[0].staves[0].bars[0].voices[0].beats.every(
        (b: any) => b.isRest,
      ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "預備拍", exact: true }).click();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForTimeout(900);
  await expect(page.locator(".reference-marker.active")).toBeVisible();
  await expect(page.locator(".reference-playhead")).toBeVisible();
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await expect(page.locator(".reference-image img")).toBeVisible();
  expect(await page.locator(".reference-marker").count()).toBe(1);
});
test("PDF pages render locally; unmarked original cannot falsely play melody", async ({ page }) => {
  await ready(page);
  await page.pdf({ path: fixture("original-sheet.pdf"), format: "A4", printBackground: true });
  await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
  await page
    .getByLabel("選擇樂譜檔案", { exact: true })
    .setInputFiles(fixture("original-sheet.pdf"));
  await expect(page.locator(".reference-image img")).toBeVisible();
  await page.getByRole("button", { name: "保存原譜，稍後標記" }).click();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "辨識音符或標記小節" })).toBeVisible();
  await expect(page.locator(".reference-image img")).toBeVisible();
  await page.screenshot({ path: "artifacts/pdf-preview.png", fullPage: true });
});
test("library search, rename, delete and storage survive reload", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "我的樂譜", exact: false }).first().click();
  await page.getByRole("button", { name: "重新命名 午後，慢慢彈" }).click();
  await page.getByLabel("曲目名稱").fill("每天五分鐘");
  await page.getByRole("button", { name: "保存名稱" }).click();
  await page.getByLabel("搜尋曲目").fill("五分鐘");
  await expect(page.locator(".library-piece")).toHaveCount(1);
  await page.getByLabel("搜尋曲目").fill("不存在");
  await expect(page.getByText("沒有符合的曲目")).toBeVisible();
  await page.getByLabel("搜尋曲目").fill("");
  await page.getByRole("button", { name: "刪除 每天五分鐘" }).click();
  await page.getByRole("button", { name: "刪除樂譜", exact: true }).click();
  await expect(page.getByText("第一首練習，從這裡開始")).toBeVisible();
  await page.reload();
  await expect(page.getByText("第一首練習，從這裡開始")).toBeVisible();
  await page.getByRole("button", { name: "載入示範曲", exact: true }).click();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.locator("h1")).toHaveText("午後，慢慢彈");
});
test("soundfont error and unavailable local storage are visible and recoverable", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/soundfont/**", (r) => r.abort());
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("音色載入失敗");
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeDisabled();
  await context.close();
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException("blocked", "SecurityError");
    };
  });
  await p.goto("/");
  await expect(p.getByRole("alert")).toContainText("本機資料庫");
  await expect(p.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await c.close();
});
