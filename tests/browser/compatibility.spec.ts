import { test, expect } from "@playwright/test";
test("mobile WebKit loads, plays, pauses, seeks and changes speed without horizontal overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "預備拍", exact: true }).click();
  await page.getByRole("button", { name: "專注練習", exact: true }).click();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__practice.state.tick))
    .toBeGreaterThan(1800);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  const tick = await page.evaluate(() => (window as any).__practice.state.tick);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as any).__practice.state.tick)).toBe(tick);
  await page.getByRole("button", { name: "跳到第 5 小節", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__practice.state.bar)).toBe(4);
  await page.getByLabel("播放速度", { exact: true }).selectOption("0.75");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__practice.state.tempo)).toBe(60);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: "artifacts/webkit-mobile.png" });
});
