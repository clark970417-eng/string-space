import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { model } from "@coderline/alphatab";
test.setTimeout(180000);
async function upload(page: any, file: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
  await page.getByLabel("選擇樂譜檔案", { exact: true }).setInputFiles(file);
  await expect(page.getByRole("button", { name: "在本機辨識音符", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "在本機辨識音符", exact: true }).click();
  await expect(page.getByLabel("校對小節與聲部")).toBeVisible({ timeout: 120000 });
}
test("real PNG recognition, correct notes and meter, persist review, then synthesize with synchronized cursor", async ({
  page,
}) => {
  await upload(page, "tests/fixtures/omr/printed-study.png");
  await expect(page.getByLabel("事件 1 音高 1", { exact: true })).toHaveValue("64");
  await expect(page.getByLabel("事件 2 音高 1", { exact: true })).toHaveValue("67");
  await expect(page.getByRole("button", { name: "確認全部，合成播放" })).toBeDisabled();
  const selector = page.getByLabel("校對小節與聲部");
  // Correct the actual engine's mistaken 6/4 signature before reviewing any voice.
  for (let b = 0; b < 4; b++) {
    await selector.selectOption(String(b));
    await page.getByLabel("本小節拍號", { exact: true }).selectOption("4/4");
  }
  const notes = [[64, 67, null, 59], [60, 62], [55, 57, 59, 62], [64]];
  for (let b = 0; b < 4; b++) {
    await selector.selectOption(String(b));
    while ((await page.getByRole("button", { name: /^刪除事件 / }).count()) > 1)
      await page
        .getByRole("button", { name: /^刪除事件 / })
        .last()
        .click();
    for (let i = 0; i < notes[b].length; i++) {
      if (i > 0) await page.getByRole("button", { name: "新增四分休止符", exact: true }).click();
      await page.getByLabel(`事件 ${i + 1} 種類`, { exact: true }).selectOption("rest");
      await page
        .getByLabel(`事件 ${i + 1} 時值`, { exact: true })
        .selectOption(String(b === 1 ? 2 : b === 3 ? 1 : 4));
      if (notes[b][i] !== null) {
        await page.getByLabel(`事件 ${i + 1} 種類`, { exact: true }).selectOption("note");
        await page
          .getByLabel(`事件 ${i + 1} 音高 1`, { exact: true })
          .selectOption(String(notes[b][i]));
      }
    }
    await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
  }
  await expect(page.locator(".score-preview .at-surface")).toBeVisible();
  await page.getByRole("button", { name: "保存校對草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "校對辨識結果與原譜", exact: true }).click();
  await expect(page.getByRole("button", { name: "確認全部，合成播放" })).toBeEnabled();
  await page.getByRole("button", { name: "確認全部，合成播放" }).click();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  const savedJson = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve,reject) => { const req=indexedDB.open("string-space-library",1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error); });
    const pieces:any[]=await new Promise((resolve,reject)=>{const req=db.transaction("pieces").objectStore("pieces").getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();
    return pieces.find(p=>p.recognition?.status==="confirmed").scoreJson;
  });
  expect(model.JsonConverter.jsonToScore(savedJson).tracks[0].staves[0].bars.map(b=>b.voices[0].beats.map(n=>n.notes[0]?.realValue??null))).toEqual(notes);
  await page.getByRole("button", { name: "預備拍", exact: true }).click();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(page.getByTestId("clock")).not.toHaveText("0:00 / 0:08");
  await expect(page.locator(".at-cursor-beat")).toBeVisible();
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await page.screenshot({ path: "artifacts/recognized-playback.png" });
});
test("real PDF and JPG recognition produce editable notes", async ({ page, browser }) => {
  const printPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  });
  const data = readFileSync("tests/fixtures/omr/printed-study.png").toString("base64");
  await printPage.setContent(`<img style="width:100%" src="data:image/png;base64,${data}">`);
  await printPage.locator("img").waitFor();
  await printPage.pdf({
    path: "tests/fixtures/omr/printed-study.pdf",
    width: "14in",
    height: "7in",
    printBackground: true,
  });
  await printPage
    .locator("img")
    .screenshot({ path: "tests/fixtures/omr/printed-study.jpg", type: "jpeg", quality: 98 });
  await printPage.close();
  for (const ext of ["pdf", "jpg"]) {
    await upload(page, `tests/fixtures/omr/printed-study.${ext}`);
    await expect(page.getByLabel("事件 1 音高 1", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "確認全部，合成播放" })).toBeDisabled();
    await page.getByRole("button", { name: "保存校對草稿", exact: true }).click();
  }
});

test("mobile correction remains readable and manual entry works when service is unavailable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**:4281/health", (r) => r.abort());
  await page.goto("/");
  await page.getByRole("button", { name: "開啟我的樂譜", exact: true }).click();
  await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
  await page
    .getByLabel("選擇樂譜檔案", { exact: true })
    .setInputFiles("tests/fixtures/omr/printed-study.png");
  await expect(page.getByText("本機辨識服務未啟動，請執行 npm run omr。")).toBeVisible();
  await page.getByRole("button", { name: "手動輸入音符與節奏", exact: true }).click();
  await page.getByLabel("事件 1 種類", { exact: true }).selectOption("note");
  await page.getByLabel("事件 1 音高 1", { exact: true }).selectOption("60");
  await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: "artifacts/mobile-recognition.png" });
  await page.getByRole("button", { name: "確認全部，合成播放" }).click();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
});
test("service rejects bad formats and invalid pages; actual job can be cancelled", async ({
  request,
}) => {
  const options = { headers: { "X-OMR-Request": "1" } };
  const bad = await request.post("http://localhost:4281/jobs?type=png", {
    ...options,
    data: "not an image",
  });
  expect(bad.status()).toBe(400);
  const pages = await request.post("http://localhost:4281/jobs?type=pdf&pages=1-99", {
    ...options,
    data: "%PDF-",
  });
  expect(pages.status()).toBe(400);
  const good = await request.post("http://localhost:4281/jobs?type=png", {
    ...options,
    data: readFileSync("tests/fixtures/omr/printed-study.png"),
  });
  expect(good.status()).toBe(202);
  const { id } = await good.json();
  expect((await request.delete(`http://localhost:4281/jobs/${id}`, options)).status()).toBe(200);
  await expect
    .poll(async () => (await (await request.get("http://localhost:4281/health")).json()).busy)
    .toBe(false);
});
