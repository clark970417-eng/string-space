import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { model, midi, Settings } from "@coderline/alphatab";
test.setTimeout(120000);
async function upload(page: any, file: string, start = true) {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "開啟我的樂譜", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
  await page.getByLabel("選擇樂譜檔案", { exact: true }).setInputFiles(file);
  await page.getByLabel("辨識譜面類型").selectOption("tab");
  if (start) {
    await page.getByRole("button", { name: "辨識六線譜弦品", exact: true }).click();
    await expect(page.getByLabel("校對小節與聲部").or(page.getByRole("alert")).first()).toBeVisible(
      { timeout: 90000 },
    );
    await expect(page.getByLabel("校對小節與聲部")).toBeVisible();
  }
}
async function saved(page: any, title?: string) {
  return page.evaluate(async (title: string | undefined) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("string-space-library", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const all: any[] = await new Promise((resolve, reject) => {
      const r = db.transaction("pieces").objectStore("pieces").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return all.find((p) => p.recognition?.tab && (!title || p.title === title));
  }, title);
}
test("real TAB PNG: strings and double-digit frets, explicit rhythm gating, edit, save, synth and synchronized cursor", async ({
  page,
}) => {
  const thirdParty: string[] = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && !["localhost", "127.0.0.1"].includes(new URL(r.url()).hostname))
      thirdParty.push(r.url());
  });
  await page.addInitScript(() => {
    (window as any).__meters = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (d: any, ...r: any[]) {
      if (d instanceof AudioDestinationNode && !(this instanceof AnalyserNode)) {
        const a = this.context.createAnalyser();
        (window as any).__meters.push(a);
        connect.call(this, a);
        connect.call(a, d);
        return d;
      }
      return (connect as any).call(this, d, ...r);
    };
  });
  await upload(page, "tests/fixtures/tab/printed-tab.png");
  for (const [i, f, s] of [
    [1, "0", "6"],
    [2, "3", "5"],
    [3, "12", "4"],
    [4, "10", "1"],
  ]) {
    await expect(page.getByLabel(`事件 ${i} 品格 1`, { exact: true })).toHaveValue(f as string);
    await expect(page.getByLabel(`事件 ${i} 弦 1`, { exact: true })).toHaveValue(s as string);
  }
  await expect(page.getByRole("button", { name: "確認全部，合成播放" })).toBeDisabled();
  await page.getByLabel("事件 3 品格 1", { exact: true }).fill("14");
  await page.getByLabel("校對 Capo", { exact: true }).selectOption("2");
  await page.getByLabel("確認調弦與 Capo", { exact: true }).check();
  await page.getByLabel("確認六線譜節奏", { exact: true }).check();
  await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
  await page.getByLabel("事件 1 時值", { exact: true }).selectOption("8");
  await expect(page.getByLabel("確認六線譜節奏", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("確認本小節音符與節奏", { exact: true })).toBeDisabled();
  await page.getByLabel("事件 1 時值", { exact: true }).selectOption("4");
  await page.getByLabel("確認六線譜節奏", { exact: true }).check();
  await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
  await page.getByRole("button", { name: "保存校對草稿", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("h1")).toHaveText("printed-tab");
  await expect.poll(async () => !!(await saved(page))).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "校對辨識結果與原譜", exact: true }).click();
  await page.getByRole("button", { name: "確認全部，合成播放" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const piece = await saved(page);
  const score = model.JsonConverter.jsonToScore(piece.scoreJson);
  expect(
    score.tracks[0].staves[0].bars[0].voices[0].beats.map((b) => b.notes[0].realValue),
  ).toEqual([66, 64, 71, 52]);
  expect(piece.suggestedFingering).toBe(false);
  expect(piece.capo).toBe(2);
  await page.getByRole("button", { name: "預備拍", exact: true }).click();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  const rms = () =>
    page.evaluate(() =>
      Math.max(
        0,
        ...(window as any).__meters.map((a: AnalyserNode) => {
          const f = new Float32Array(a.fftSize);
          a.getFloatTimeDomainData(f);
          return Math.sqrt(f.reduce((s, v) => s + v * v, 0) / f.length);
        }),
      ),
    );
  await expect.poll(rms).toBeGreaterThan(0.001);
  await expect(page.locator(".at-cursor-beat")).toBeVisible();
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await expect.poll(rms).toBeLessThan(0.001);
  await page.getByLabel("播放速度", { exact: true }).selectOption("0.5");
  await expect(page.getByTestId("clock")).toContainText("0:06");
  await page.screenshot({ path: "artifacts/tab-playback.png" });
  expect(thirdParty).toEqual([]);
});
test("real JPG and two-page PDF TAB recognition, with page range selection", async ({
  page,
  browser,
}) => {
  await upload(page, "tests/fixtures/tab/printed-tab.jpg");
  await expect(page.getByLabel("事件 3 品格 1", { exact: true })).toHaveValue("12");
  const p = await browser.newPage();
  const data = readFileSync("tests/fixtures/tab/printed-tab.png").toString("base64");
  await p.setContent(
    `<style>@page{size:18in 6.5in;margin:0}body{margin:0}img{width:100%;display:block}section{break-after:page}</style><section><img src="data:image/png;base64,${data}"></section><section><img src="data:image/png;base64,${data}"></section>`,
  );
  await p.pdf({
    path: "tests/fixtures/tab/printed-tab.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  await p.close();
  await upload(page, "tests/fixtures/tab/printed-tab.pdf", false);
  await page.getByLabel("辨識 PDF 頁碼").fill("1-2");
  await page.getByRole("button", { name: "辨識六線譜弦品", exact: true }).click();
  await expect(page.getByLabel("校對小節與聲部")).toBeVisible({ timeout: 90000 });
  await expect(page.getByLabel("校對小節與聲部").locator("option")).toHaveCount(2);
  await page.getByLabel("校對小節與聲部").selectOption("1");
  await expect(page.getByText("第 2 小節原圖 · 第 2 頁")).toBeVisible();
  await expect(page.getByLabel("事件 3 品格 1", { exact: true })).toHaveValue("12");
});
test("cancellation and unreadable scan stay honest; mobile review does not overflow", async ({
  page,
}) => {
  await upload(page, "tests/fixtures/tab/printed-tab.png", false);
  await page.getByRole("button", { name: "辨識六線譜弦品", exact: true }).click();
  await page.getByRole("button", { name: "取消辨識", exact: true }).click();
  await expect(page.getByRole("button", { name: "辨識六線譜弦品", exact: true })).toBeEnabled();
  await expect(page.getByLabel("校對小節與聲部")).toHaveCount(0);
  await page.getByRole("button", { name: "辨識六線譜弦品", exact: true }).click();
  await expect(page.getByLabel("校對小節與聲部")).toBeVisible({ timeout: 90000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("事件 3 品格 1", { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: "artifacts/tab-mobile-review.png" });
});

test("visible beams and vertically aligned notes produce rhythm candidates and simultaneous strings", async ({
  page,
}) => {
  await upload(page, "tests/fixtures/tab/chord-tab.png");
  await expect(page.getByLabel("事件 1 品格 1", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("事件 1 品格 2", { exact: true })).toHaveValue("1");
  await expect(page.getByLabel("事件 3 時值", { exact: true })).toHaveValue("8");
  await expect(page.getByLabel("事件 4 時值", { exact: true })).toHaveValue("8");
  await expect(page.getByRole("button", { name: "確認全部，合成播放" })).toBeDisabled();
  await page.getByLabel("本小節拍號", { exact: true }).selectOption("3/4");
  await page.getByLabel("確認調弦與 Capo", { exact: true }).check();
  await page.getByLabel("確認六線譜節奏", { exact: true }).check();
  await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
  await expect(page.getByRole("button", { name: "確認全部，合成播放" })).toBeEnabled();
});

test("unreadable image gives a truthful error with manual fallback and no substituted score", async ({
  page,
}) => {
  await upload(page, "tests/fixtures/tab/blank.png", false);
  await page.getByRole("button", { name: "辨識六線譜弦品", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("找不到清楚、水平且等距的六條譜線", {
    timeout: 60000,
  });
  await expect(page.getByLabel("校對小節與聲部")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "手動輸入音符與節奏", exact: true })).toBeEnabled();
});

test("missing local OCR resources show a recoverable error instead of hanging", async ({
  page,
}) => {
  await page.route("**/ocr/worker.min.js", (r) => r.abort());
  await upload(page, "tests/fixtures/tab/printed-tab.png", false);
  await page.getByRole("button", { name: "辨識六線譜弦品", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("數字辨識資源載入失敗");
  await expect(page.getByRole("button", { name: "手動輸入音符與節奏", exact: true })).toBeEnabled();
});

test("recognizes a real notation renderer TAB export, not only the geometric fixture", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
  await page
    .getByLabel("選擇樂譜檔案", { exact: true })
    .setInputFiles("tests/fixtures/known.musicxml");
  await page.getByRole("button", { name: "確認並開始練習", exact: true }).click();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await expect(page.locator("[data-bar]")).toHaveCount(4);
  await page.addStyleTag({
    content: ".transport,.at-cursor-bar,.at-cursor-beat{visibility:hidden!important}",
  });
  await page.locator(".sheet-paper").screenshot({ path: "tests/fixtures/tab/renderer-tab.png" });
  await upload(page, "tests/fixtures/tab/renderer-tab.png");
  await expect(page.getByLabel("事件 1 品格 1", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("事件 2 品格 1", { exact: true })).toHaveValue("3");
  await expect(page.getByRole("button", { name: "確認全部，合成播放" })).toBeDisabled();
});

async function rhythmFixture(
  page: any,
  kind: "dots" | "double" | "rests" | "triplet" | "quintuplet" | "sextuplet",
) {
  await page.goto("/");
  const data = await page.evaluate(async (kind: string) => {
    const font = await new FontFace("FixtureMusic", "url(/font/Bravura.woff2)").load();
    document.fonts.add(font);
    const c = document.createElement("canvas");
    c.width = 1800;
    c.height = 650;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1800, 650);
    ctx.fillStyle = "black";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(100, 200 + i * 40);
      ctx.lineTo(1650, 200 + i * 40);
      ctx.stroke();
    }
    for (const x of [100, 1650]) {
      ctx.beginPath();
      ctx.moveTo(x, 200);
      ctx.lineTo(x, 400);
      ctx.stroke();
    }
    const note = (x: number, f: number) => {
      ctx.fillStyle = "white";
      ctx.fillRect(x - 17, 178, 34, 40);
      ctx.fillStyle = "black";
      ctx.font = "32px Arial";
      ctx.textAlign = "center";
      ctx.fillText(String(f), x, 211);
      ctx.fillRect(x + 12, 425, 2, 75);
    };
    const rest = (x: number, code: number) => {
      ctx.font = "80px FixtureMusic";
      ctx.textAlign = "left";
      ctx.fillText(String.fromCodePoint(code), x, 470);
    };
    if (kind === "rests") {
      rest(300, 0xe4e5);
      rest(650, 0xe4e6);
      rest(1000, 0xe4e7);
      rest(1350, 0xe4e8);
      ctx.beginPath();
      ctx.arc(687, 470, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "dots" || kind === "double") {
      note(300, 0);
      ctx.beginPath();
      ctx.arc(332, 200, 4, 0, Math.PI * 2);
      ctx.fill();
      if (kind === "double") {
        ctx.beginPath();
        ctx.arc(346, 200, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      rest(650, kind === "double" ? 0xe4e7 : 0xe4e6);
      rest(1000, 0xe4e5);
      note(1350, 3);
    } else {
      const n = kind === "triplet" ? 3 : kind === "quintuplet" ? 5 : 6;
      const xs = Array.from({ length: n }, (_, i) => 230 + i * (750 / (n - 1)));
      xs.forEach((x, i) => note(x, i));
      if (n >= 5) ctx.fillRect(xs[0] + 12, 490, 750, 6);
      const mid = (xs[0] + xs[n - 1]) / 2;
      ctx.font = "32px Arial";
      ctx.textAlign = "center";
      ctx.fillText(String(n), mid, 147);
      ctx.beginPath();
      ctx.moveTo(xs[0] - 8, 150);
      ctx.lineTo(xs[0] - 8, 135);
      ctx.lineTo(mid - 25, 135);
      ctx.moveTo(mid + 25, 135);
      ctx.lineTo(xs[n - 1] + 8, 135);
      ctx.lineTo(xs[n - 1] + 8, 150);
      ctx.stroke();
      rest(1200, 0xe4e5);
      note(1450, 7);
    }
    return c.toDataURL();
  }, kind);
  return Buffer.from(data.split(",")[1], "base64");
}
async function uploadBuffer(
  page: any,
  buffer: Buffer,
  name: string,
  mimeType: string,
  pages?: string,
) {
  const menu = page.getByRole("button", { name: "開啟我的樂譜", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
  await page.getByLabel("選擇樂譜檔案", { exact: true }).setInputFiles({ name, mimeType, buffer });
  await page.getByLabel("辨識譜面類型").selectOption("tab");
  if (pages) await page.getByLabel("辨識 PDF 頁碼", { exact: true }).fill(pages);
  await page.getByRole("button", { name: "辨識六線譜弦品", exact: true }).click();
  await expect(page.getByLabel("校對小節與聲部")).toBeVisible({ timeout: 90000 });
}
test("rhythm symbols: dotted note, eighth and quarter rests from PNG and PDF, correction and exact playback ticks", async ({
  page,
  browser,
}) => {
  const png = await rhythmFixture(page, "dots");
  const print = await browser.newPage();
  await print.setContent(
    `<style>@page{size:18in 6.5in;margin:0}body{margin:0}img{width:100%}</style><img src="data:image/png;base64,${png.toString("base64")}">`,
  );
  const pdf = await print.pdf({ preferCSSPageSize: true });
  writeFileSync("tests/fixtures/tab/rhythm-study.png", png);
  writeFileSync("tests/fixtures/tab/rhythm-study.pdf", pdf);
  await print.close();
  for (const [name, mimeType, buffer] of [
    ["rhythm-image.png", "image/png", png],
    ["rhythm-pdf.pdf", "application/pdf", pdf],
  ] as const) {
    await page.goto("/");
    await uploadBuffer(page, buffer, name, mimeType);
    await expect(page.getByLabel("事件 1 附點", { exact: true })).toHaveValue("1");
    await expect(page.getByLabel("事件 2 種類", { exact: true })).toHaveValue("rest");
    await expect(page.getByLabel("事件 2 時值", { exact: true })).toHaveValue("8");
    await expect(page.getByLabel("事件 3 種類", { exact: true })).toHaveValue("rest");
    await expect(page.getByLabel("事件 3 時值", { exact: true })).toHaveValue("4");
    await page.getByLabel("事件 1 附點", { exact: true }).selectOption("2");
    await page.getByLabel("事件 2 時值", { exact: true }).selectOption("16");
    await page.getByLabel("確認調弦與 Capo", { exact: true }).check();
    await page.getByLabel("確認六線譜節奏", { exact: true }).check();
    await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
    await page.getByRole("button", { name: "確認全部，合成播放", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const piece = await saved(page, name.replace(/\.[^.]+$/, ""));
    const score = model.JsonConverter.jsonToScore(piece.scoreJson);
    expect(
      score.tracks[0].staves[0].bars[0].voices[0].beats.map((b) => b.playbackDuration),
    ).toEqual([1680, 240, 960, 960]);
    await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await expect(page.locator(".at-cursor-beat")).toBeVisible();
    await page.getByRole("button", { name: "暫停", exact: true }).click();
  }
});
test("rhythm symbols: explicit triplet, quintuplet and sextuplet brackets set the complete group only", async ({
  page,
}) => {
  for (const kind of ["triplet", "quintuplet", "sextuplet"] as const) {
    const png = await rhythmFixture(page, kind);
    await uploadBuffer(page, png, `${kind}.png`, "image/png");
    const n = kind === "triplet" ? 3 : kind === "quintuplet" ? 5 : 6;
    for (let i = 1; i <= n; i++)
      await expect(page.getByLabel(`事件 ${i} 連音`, { exact: true })).toHaveValue(
        n === 3 ? "3:2" : `${n}:4`,
      );
    await expect(page.getByLabel(`事件 ${n + 1} 連音`, { exact: true })).toHaveValue("1:1");
    await page.getByLabel("確認調弦與 Capo", { exact: true }).check();
    await page.getByLabel("確認六線譜節奏", { exact: true }).check();
    await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
    await expect(
      page.getByRole("button", { name: "確認全部，合成播放", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "保存校對草稿", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
});

test("rhythm symbols: double dots and sixteenth rest are read from source, not inferred from meter", async ({
  page,
}) => {
  const png = await rhythmFixture(page, "double");
  await uploadBuffer(page, png, "double.png", "image/png");
  await expect(page.getByLabel("事件 1 附點", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("事件 2 時值", { exact: true })).toHaveValue("16");
  await expect(page.getByLabel("事件 2 種類", { exact: true })).toHaveValue("rest");
  await page.getByLabel("事件 1 連音", { exact: true }).selectOption("3:2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: `artifacts/rhythm-review-${page.viewportSize()?.width}.png` });
  await page.getByRole("button", { name: "將 3:2 套用至事件 1–3", exact: true }).click();
  await expect(page.getByLabel("事件 3 連音", { exact: true })).toHaveValue("3:2");
  await expect(page.getByLabel("確認本小節音符與節奏", { exact: true })).toBeDisabled();
});

test("rhythm symbols: rest-only image preserves four rest values and dotted rest", async ({
  page,
}) => {
  const png = await rhythmFixture(page, "rests");
  await uploadBuffer(page, png, "rests.png", "image/png");
  for (const [i, d] of [4, 8, 16, 32].entries()) {
    await expect(page.getByLabel(`事件 ${i + 1} 種類`, { exact: true })).toHaveValue("rest");
    await expect(page.getByLabel(`事件 ${i + 1} 時值`, { exact: true })).toHaveValue(String(d));
  }
  await expect(page.getByLabel("事件 2 附點", { exact: true })).toHaveValue("1");
  await expect(
    page.getByRole("button", { name: "確認全部，合成播放", exact: true }),
  ).toBeDisabled();
});
test("missing rhythm font offers manual correction instead of claiming a completed scan", async ({
  page,
}) => {
  await page.route("**/font/Bravura.woff2", (r) => r.abort());
  await upload(page, "tests/fixtures/tab/printed-tab.png", false);
  await page.getByRole("button", { name: "辨識六線譜弦品", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("節奏符號字型載入失敗");
  await expect(page.getByRole("button", { name: "手動輸入音符與節奏", exact: true })).toBeEnabled();
});

async function tiedFixture(page: any, kind: "rests" | "ties") {
  await page.goto("/");
  const data = await page.evaluate((kind: string) => {
    const c = document.createElement("canvas");
    c.width = 1800;
    c.height = 650;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1800, 650);
    ctx.fillStyle = "black";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(100, 200 + i * 40, 1600, 2);
    }
    for (const x of [100, 900, 1700]) ctx.fillRect(x, 200, 2, 202);
    if (kind === "rests") {
      ctx.fillRect(488, 240, 25, 11);
      ctx.fillRect(1088, 230, 25, 12);
      ctx.fillRect(1388, 230, 25, 12);
    } else {
      for (const x of [200, 400, 600, 800, 1000, 1200, 1400, 1600]) {
        ctx.fillStyle = "white";
        ctx.fillRect(x - 18, 178, 36, 42);
        ctx.fillStyle = "black";
        ctx.font = "32px Arial";
        ctx.textAlign = "center";
        ctx.fillText("0", x, 212);
        ctx.fillRect(x + 12, 425, 2, 75);
      }
      for (const [a, b] of [
        [200, 400],
        [800, 1000],
      ]) {
        ctx.beginPath();
        for (let x = a + 18; x <= b - 18; x++) {
          const t = (x - a - 18) / (b - a - 36);
          const y = 201 - 24 - 22 * 4 * t * (1 - t);
          if (x === a + 18) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    return c.toDataURL();
  }, kind);
  return Buffer.from(data.split(",")[1], "base64");
}
async function splitTieFixture(page: import("@playwright/test").Page) {
  await page.goto("/");
  return page.evaluate(() => {
    const draw = (incoming: boolean, outgoing: boolean) => {
      const c = document.createElement("canvas");
      c.width = 1000;
      c.height = 650;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "black";
      ctx.strokeStyle = "black";
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) ctx.fillRect(100, 200 + i * 40, 800, 2);
      for (const x of [100, 900]) ctx.fillRect(x, 200, 2, 202);
      for (const x of [200, 400, 600, 800]) {
        ctx.fillStyle = "white";
        ctx.fillRect(x - 18, 178, 36, 42);
        ctx.fillStyle = "black";
        ctx.font = "32px Arial";
        ctx.textAlign = "center";
        ctx.fillText("0", x, 212);
        ctx.fillRect(x + 12, 425, 2, 75);
      }
      const arc = (start: number, end: number, half: boolean) => {
        ctx.beginPath();
        for (let i = 0; i <= 100; i++) {
          const t = i / 100,
            x = start + (end - start) * t;
          const y = 201 - 24 - 22 * (half ? 2 * t - t * t : 4 * t * (1 - t));
          if (!i) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      if (outgoing) {
        arc(218, 382, false);
        arc(818, 896, true);
      }
      if (incoming) arc(182, 104, true);
      return c;
    };
    const a = draw(false, true),
      b = draw(true, false);
    const joined = document.createElement("canvas");
    joined.width = 1000;
    joined.height = 1300;
    joined.getContext("2d")!.drawImage(a, 0, 0);
    joined.getContext("2d")!.drawImage(b, 0, 650);
    const missing = document.createElement("canvas");
    missing.width = 1000;
    missing.height = 1300;
    missing.getContext("2d")!.drawImage(a, 0, 0);
    missing.getContext("2d")!.drawImage(draw(false, false), 0, 650);
    return {
      joined: joined.toDataURL(),
      missing: missing.toDataURL(),
      first: a.toDataURL(),
      second: b.toDataURL(),
    };
  });
}
test("whole and half rests: real PNG/PDF support-line classification and whole-bar meter correction", async ({
  page,
  browser,
}) => {
  const png = await tiedFixture(page, "rests");
  const print = await browser.newPage();
  await print.setContent(
    `<style>@page{size:18in 6.5in;margin:0}body{margin:0}img{width:100%}</style><img src="data:image/png;base64,${png.toString("base64")}">`,
  );
  const pdf = await print.pdf({ preferCSSPageSize: true });
  await print.close();
  writeFileSync("tests/fixtures/tab/whole-half-rests.pdf", pdf);
  for (const [name, type, buffer] of [
    ["whole-rest.png", "image/png", png],
    ["whole-rest.pdf", "application/pdf", pdf],
  ] as const) {
    await page.goto("/");
    await uploadBuffer(
      page,
      buffer,
      name,
      type,
      name === "cross-page-ties.pdf" ? "1-2" : undefined,
    );
    await expect(page.getByLabel("事件 1 種類", { exact: true })).toHaveValue("rest");
    await expect(page.getByLabel("事件 1 時值", { exact: true })).toHaveValue("1");
    await page.getByLabel("本小節拍號", { exact: true }).selectOption("3/4");
    await expect(page.getByText("目前時值：3 個四分拍", { exact: false })).toBeVisible();
    await page.getByLabel("確認調弦與 Capo", { exact: true }).check();
    await page.getByLabel("確認六線譜節奏", { exact: true }).check();
    await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
    await page.getByLabel("校對小節與聲部").selectOption("1");
    await expect(page.getByLabel("事件 1 時值", { exact: true })).toHaveValue("2");
    await expect(page.getByLabel("事件 2 時值", { exact: true })).toHaveValue("2");
  }
});
test("tie arcs: PNG/PDF within-bar and cross-bar ties, edit invalidation and a single pluck per chain", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    (window as any).__tieMeters = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination: any, ...rest: any[]) {
      if (destination instanceof AudioDestinationNode && !(this instanceof AnalyserNode)) {
        const analyser = this.context.createAnalyser();
        (window as any).__tieMeters.push(analyser);
        connect.call(this, analyser);
        connect.call(analyser, destination);
        return destination;
      }
      return (connect as any).call(this, destination, ...rest);
    };
  });
  test.setTimeout(120000);
  const png = await tiedFixture(page, "ties");
  const print = await browser.newPage();
  await print.setContent(
    `<style>@page{size:18in 6.5in;margin:0}body{margin:0}img{width:100%}</style><img src="data:image/png;base64,${png.toString("base64")}">`,
  );
  const pdf = await print.pdf({ preferCSSPageSize: true });
  await print.close();
  writeFileSync("tests/fixtures/tab/tied-study.png", png);
  writeFileSync("tests/fixtures/tab/tied-study.pdf", pdf);
  const split = await splitTieFixture(page);
  const splitPng = Buffer.from(split.joined.split(",")[1], "base64");
  const splitPrint = await browser.newPage();
  await splitPrint.setContent(
    `<style>@page{size:10in 6.5in;margin:0}body{margin:0}img{display:block;width:100%;height:6.5in;break-after:page}</style><img src="${split.first}"><img src="${split.second}">`,
  );
  const splitPdf = await splitPrint.pdf({ preferCSSPageSize: true });
  await splitPrint.close();
  writeFileSync("tests/fixtures/tab/cross-system-ties.png", splitPng);
  writeFileSync("tests/fixtures/tab/cross-page-ties.pdf", splitPdf);
  for (const [name, type, buffer] of [
    ["ties-image.png", "image/png", png],
    ["ties-pdf.pdf", "application/pdf", pdf],
    ["cross-system-ties.png", "image/png", splitPng],
    ["cross-page-ties.pdf", "application/pdf", splitPdf],
  ] as const) {
    await page.goto("/");
    await uploadBuffer(
      page,
      buffer,
      name,
      type,
      name === "cross-page-ties.pdf" ? "1-2" : undefined,
    );
    await expect(page.getByLabel("事件 2 音 1 延音線", { exact: true })).toBeChecked();
    await expect(page.getByLabel("事件 3 音 1 延音線", { exact: true })).not.toBeChecked();
    await page.getByLabel("校對小節與聲部").selectOption("1");
    await expect(page.getByLabel("事件 1 音 1 延音線", { exact: true }), name).toBeChecked();
    await page.getByLabel("事件 1 品格 1", { exact: true }).fill("3");
    await expect(page.getByLabel("事件 1 品格 1", { exact: true })).toHaveValue("3");
    await expect(page.getByLabel("事件 1 音 1 延音線", { exact: true })).not.toBeChecked();
    await page.getByLabel("事件 1 品格 1", { exact: true }).fill("0");
    await page.getByLabel("事件 1 音 1 延音線", { exact: true }).check();
    await page.getByLabel("確認調弦與 Capo", { exact: true }).check();
    for (const bar of ["0", "1"]) {
      await page.getByLabel("校對小節與聲部").selectOption(bar);
      await page.getByLabel("確認六線譜節奏", { exact: true }).check();
      await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
    }
    await page.getByRole("button", { name: "確認全部，合成播放", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const piece = await saved(page, name.replace(/\.[^.]+$/, ""));
    const score = model.JsonConverter.jsonToScore(piece.scoreJson);
    const notes = score.tracks[0].staves[0].bars.flatMap((b) =>
      b.voices[0].beats.flatMap((b) => b.notes),
    );
    expect(notes.filter((n) => n.isTieDestination)).toHaveLength(2);
    expect(notes[1].tieOrigin).toBe(notes[0]);
    expect(notes[4].tieOrigin).toBe(notes[3]);
    const attacks: { tick: number; length: number }[] = [];
    const handler = new midi.AlphaSynthMidiFileHandler(new midi.MidiFile());
    const addNote = handler.addNote.bind(handler);
    handler.addNote = (...args: Parameters<typeof handler.addNote>) => {
      attacks.push({ tick: args[1], length: args[2] });
      addNote(...args);
    };
    new midi.MidiFileGenerator(score, new Settings(), handler).generate();
    expect(attacks).toHaveLength(6);
    expect(attacks.find((n) => n.tick === 2880)?.length).toBe(1920);
    expect(attacks.some((n) => n.tick === 3840)).toBe(false);

    if (name.startsWith("cross-")) {
      expect(piece.recognition.tab.measures[1].boundaryFrom).toBe(0);
      expect(piece.recognition.tab.measures[1].page).toBe(name.endsWith("pdf") ? 2 : 1);
    }

    await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
    const count = page.getByRole("button", { name: "預備拍", exact: true });
    if ((await count.getAttribute("aria-pressed")) === "true") await count.click();
    await page.getByLabel("播放速度", { exact: true }).selectOption("0.75");
    const rms = () =>
      page.evaluate(() =>
        Math.max(
          0,
          ...(window as any).__tieMeters.map((a: AnalyserNode) => {
            const f = new Float32Array(a.fftSize);
            a.getFloatTimeDomainData(f);
            return Math.sqrt(f.reduce((s, v) => s + v * v, 0) / f.length);
          }),
        ),
      );
    // Arm before playback; sample audio and UI in the same browser frame.
    // Playwright round trips must not push the measurement past the tied interval.
    await page.evaluate(() => {
      (window as any).__tieSample = new Promise((resolve, reject) => {
        const deadline = performance.now() + 15000;
        const sample = () => {
          const position = Number(
            document.querySelector<HTMLInputElement>('[aria-label="播放進度"]')?.value,
          );
          if (position > 4100 && position < 4800) {
            const rms = Math.max(
              0,
              ...(window as any).__tieMeters.map((a: AnalyserNode) => {
                const f = new Float32Array(a.fftSize);
                a.getFloatTimeDomainData(f);
                return Math.sqrt(f.reduce((s, v) => s + v * v, 0) / f.length);
              }),
            );
            const cursor = document.querySelector(".at-cursor-beat");
            resolve({
              position,
              rms,
              bar: document.querySelector('[data-testid="bar-label"]')?.textContent,
              cursorVisible: !!cursor?.getBoundingClientRect().height,
            });
          } else if (position >= 4800 || performance.now() > deadline) {
            reject(new Error(`Missed tied audio sample: ${position} ms`));
          } else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    });
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await expect.poll(rms).toBeGreaterThan(0.001);
    const sample = await page.evaluate(() => (window as any).__tieSample);
    expect(sample.position).toBeGreaterThan(4100);
    expect(sample.position).toBeLessThan(4800);
    expect(sample.bar).toContain("第 2 / 2");
    expect(sample.cursorVisible).toBe(true);
    expect(sample.rms).toBeGreaterThan(0.00001);
    await page.getByRole("button", { name: "暫停", exact: true }).click();
    await expect.poll(rms).toBeLessThan(0.001);
  }
});

test("mobile tie correction: cross-bar source, draft reload and incompatible pitch clear both links", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const split = await splitTieFixture(page);
  const png = Buffer.from(split.joined.split(",")[1], "base64");
  await uploadBuffer(page, png, "mobile-ties.png", "image/png");
  await page.getByLabel("校對小節與聲部").selectOption("1");
  await expect(page.getByLabel("事件 1 音 1 延音線", { exact: true })).toBeChecked();
  await page.getByLabel("事件 1 音 1 延音線", { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: `artifacts/tie-review-${page.viewportSize()?.width}.png` });
  await page.getByRole("button", { name: "保存校對草稿", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "校對辨識結果與原譜", exact: true }).click();
  await page.getByLabel("校對小節與聲部").selectOption("1");
  await expect(page.getByLabel("事件 1 音 1 延音線", { exact: true })).toBeChecked();
  await page.getByLabel("校對小節與聲部").selectOption("0");
  await page.getByLabel("事件 4 品格 1", { exact: true }).fill("3");
  await page.getByLabel("校對小節與聲部").selectOption("1");
  await expect(page.getByLabel("事件 1 音 1 延音線", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("事件 1 品格 1", { exact: true })).toHaveValue("0");
});

test("split tie safety: missing half and skipped PDF page never join equal pitches", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const fixture = await splitTieFixture(page);
  const print = await browser.newPage();
  await print.setContent(
    `<style>@page{size:10in 6.5in;margin:0}body{margin:0}img{display:block;width:100%;height:6.5in;break-after:page}</style><img src="${fixture.first}"><img src="${fixture.second}"><img src="${fixture.second}">`,
  );
  const pdf = await print.pdf({ preferCSSPageSize: true });
  await print.close();
  for (const [name, mime, buffer, pages] of [
    [
      "missing-half.png",
      "image/png",
      Buffer.from(fixture.missing.split(",")[1], "base64"),
      undefined,
    ],
    ["skip-page.pdf", "application/pdf", pdf, "1,3"],
  ] as const) {
    await page.goto("/");
    await uploadBuffer(page, buffer, name, mime, pages);
    await page.getByLabel("校對小節與聲部").selectOption("1");
    await expect(page.getByLabel("事件 1 音 1 延音線", { exact: true })).not.toBeChecked();
    // Manual correction remains available; candidate absence is not a lockout.
    await page.getByLabel("事件 1 音 1 延音線", { exact: true }).check();
    await expect(page.getByLabel("事件 1 音 1 延音線", { exact: true })).toBeChecked();
    await page.getByRole("button", { name: "保存校對草稿", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const piece = await saved(page, name.replace(/\.[^.]+$/, ""));
    expect(piece.recognition.tab.measures[1].boundaryFrom).toBeUndefined();
  }
});

test("repeat signs and endings: PNG/PDF real marks, correction, native order and synchronized return", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    (window as any).__tieMeters = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination: any, ...rest: any[]) {
      if (destination instanceof AudioDestinationNode && !(this instanceof AnalyserNode)) {
        const analyser = this.context.createAnalyser();
        (window as any).__tieMeters.push(analyser);
        connect.call(this, analyser);
        connect.call(analyser, destination);
        return destination;
      }
      return (connect as any).call(this, destination, ...rest);
    };
  });
  test.setTimeout(120000);
  await page.goto("/");
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 2000;
    c.height = 650;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "black";
    for (let i = 0; i < 6; i++) ctx.fillRect(100, 200 + i * 40, 1800, 2);
    for (const x of [100, 700, 1300, 1900]) ctx.fillRect(x, 200, 2, 202);
    for (const x of [110, 1310]) ctx.fillRect(x, 200, 4, 202);
    for (const x of [135, 1275])
      for (const y of [280, 320]) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    for (let bar = 0; bar < 3; bar++)
      for (const x0 of [200, 350, 500, 600]) {
        const x = x0 + bar * 600;
        ctx.fillStyle = "white";
        ctx.fillRect(x - 18, 178, 36, 42);
        ctx.fillStyle = "black";
        ctx.font = "32px Arial";
        ctx.textAlign = "center";
        ctx.fillText("0", x, 212);
        ctx.fillRect(x + 12, 425, 2, 75);
      }
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 218; x <= 332; x++) {
      const t = (x - 218) / 114,
        y = 201 - 24 - 22 * 4 * t * (1 - t);
      if (x === 218) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (const [left, right, label] of [
      [700, 1290, "1"],
      [1300, 1890, "2"],
    ] as const) {
      ctx.fillRect(left, 100, right - left, 2);
      ctx.fillRect(left, 100, 2, 22);
      ctx.font = "28px Arial";
      ctx.textAlign = "left";
      ctx.fillText(label, left + 18, 132);
    }
    return c.toDataURL();
  });
  const png = Buffer.from(data.split(",")[1], "base64");
  const print = await browser.newPage();
  await print.setContent(
    `<style>@page{size:20in 6.5in;margin:0}body{margin:0}img{width:100%}</style><img src="${data}">`,
  );
  const pdf = await print.pdf({ preferCSSPageSize: true });
  await print.close();
  writeFileSync("tests/fixtures/tab/repeat-endings.png", png);
  writeFileSync("tests/fixtures/tab/repeat-endings.pdf", pdf);
  for (const [name, mime, buffer] of [
    ["repeat-endings.png", "image/png", png],
    ["repeat-endings.pdf", "application/pdf", pdf],
  ] as const) {
    await page.goto("/");
    await uploadBuffer(page, buffer, name, mime);
    await expect(page.getByLabel("本小節為反覆起點")).toBeChecked();
    await expect(page.getByTestId("repeat-order")).toHaveText("播放小節順序：1 → 2 → 1 → 3");
    await expect(page.getByLabel("事件 2 音 1 延音線", { exact: true })).toBeChecked();
    await page.getByLabel("校對小節與聲部").selectOption("1");
    await expect(page.getByLabel("本小節房號")).toHaveValue("1");
    await expect(page.getByLabel("反覆結束與總遍數")).toHaveValue("2");
    await page.getByLabel("反覆結束與總遍數").selectOption("3");
    await expect(page.getByRole("alert")).toContainText("兩遍");
    await page.getByLabel("反覆結束與總遍數").selectOption("2");
    await page.getByLabel("校對小節與聲部").selectOption("2");
    await expect(page.getByLabel("本小節房號")).toHaveValue("2");
    await page.getByLabel("校對速度 BPM").fill("160");
    await page.getByLabel("確認調弦與 Capo", { exact: true }).check();
    for (const bar of ["0", "1", "2"]) {
      await page.getByLabel("校對小節與聲部").selectOption(bar);
      await page.getByLabel("確認六線譜節奏", { exact: true }).check();
      await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
    }
    await page.getByRole("button", { name: "確認全部，合成播放", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const piece = await saved(page, "repeat-endings");
    const score = model.JsonConverter.jsonToScore(piece.scoreJson);
    const attacks: number[] = [];
    const h = new midi.AlphaSynthMidiFileHandler(new midi.MidiFile());
    const add = h.addNote.bind(h);
    h.addNote = (...a) => {
      attacks.push(a[1]);
      add(...a);
    };
    const g = new midi.MidiFileGenerator(score, new Settings(), h);
    g.generate();
    expect(g.tickLookup.masterBars.map((b) => b.masterBar.index)).toEqual([0, 1, 0, 2]);
    expect(attacks).toContain(7680);
    expect(attacks).not.toContain(8640);
    const count = page.getByRole("button", { name: "預備拍", exact: true });
    if ((await count.getAttribute("aria-pressed")) === "true") await count.click();
    await page.evaluate(() => {
      (window as any).__repeatFrames = [];
      (window as any).__returnRms = 0;
      let previous = "";
      const start = performance.now();
      const frame = () => {
        const label = document.querySelector('[data-testid="bar-label"]')?.textContent || "";
        const position = Number(
          document.querySelector<HTMLInputElement>('[aria-label="播放進度"]')?.value,
        );
        if (position > 3200 && position < 3600) {
          for (const a of (window as any).__tieMeters) {
            const f = new Float32Array(a.fftSize);
            a.getFloatTimeDomainData(f);
            (window as any).__returnRms = Math.max(
              (window as any).__returnRms,
              Math.sqrt(f.reduce((sum: number, v: number) => sum + v * v, 0) / f.length),
            );
          }
        }
        if (label !== previous) {
          (window as any).__repeatFrames.push({
            label,
            position,
            cursor: !!document.querySelector(".at-cursor-beat")?.getBoundingClientRect().height,
          });
          previous = label;
        }
        if (performance.now() - start < 9000) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__repeatFrames.map((f: any) => f.label).join("|")),
      )
      .toMatch(/第 1 \/ 3.*第 2 \/ 3.*第 1 \/ 3.*第 3 \/ 3/);
    const frames = await page.evaluate(() => (window as any).__repeatFrames);
    const returnFrame = frames.find((f: any) => f.label.includes("第 1 / 3") && f.position >= 2900);
    expect(returnFrame.position).toBeGreaterThanOrEqual(2900);
    expect(returnFrame.position).toBeLessThan(4000);
    expect(returnFrame.cursor).toBe(true);
    expect(await page.evaluate(() => (window as any).__returnRms)).toBeGreaterThan(0.00001);
    await page.getByRole("button", { name: "暫停", exact: true }).click();
  }
});

test("repeat mobile review: order correction, draft persistence and no overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page, "tests/fixtures/tab/repeat-endings.png");
  await expect(page.getByTestId("repeat-order")).toHaveText("播放小節順序：1 → 2 → 1 → 3");
  await page.getByLabel("校對小節與聲部").selectOption("2");
  await page.getByLabel("本小節房號").selectOption("0");
  await expect(page.getByRole("alert")).toContainText("需要二房");
  await expect(
    page.getByRole("button", { name: "確認全部，合成播放", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("本小節房號").selectOption("2");
  await page.getByTestId("repeat-order").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: "artifacts/repeat-review-mobile.png" });
  await page.getByRole("button", { name: "保存校對草稿", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "校對辨識結果與原譜", exact: true }).click();
  await expect(page.getByTestId("repeat-order")).toHaveText("播放小節順序：1 → 2 → 1 → 3");
});
test("manual DC al Fine correction validates target, persists native playback order", async ({
  page,
}) => {
  await upload(page, "tests/fixtures/tab/repeat-endings.png");
  const select = page.getByLabel("校對小節與聲部");
  await select.selectOption("0");
  await page.getByLabel("本小節為反覆起點", { exact: true }).uncheck();
  await select.selectOption("1");
  await page.getByLabel("本小節房號", { exact: true }).selectOption("0");
  await page.getByLabel("反覆結束與總遍數").selectOption("0");
  await select.selectOption("2");
  await page.getByLabel("本小節房號", { exact: true }).selectOption("0");
  await page.getByLabel("本小節結尾跳轉", { exact: true }).selectOption("8");
  await expect(page.getByRole("alert")).toContainText("Fine");
  await expect(page.getByRole("button", { name: "確認全部，合成播放" })).toBeDisabled();
  await select.selectOption("1");
  await page.getByLabel("本小節結尾為 Fine", { exact: true }).check();
  await expect(page.getByTestId("repeat-order")).toContainText("1 → 2 → 3 → 1 → 2");
  await page.getByRole("button", { name: "保存校對草稿", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const piece = await saved(page, "repeat-endings");
  const score = model.JsonConverter.jsonToScore(piece.scoreJson);
  const gen = new midi.MidiFileGenerator(
    score,
    new Settings(),
    new midi.AlphaSynthMidiFileHandler(new midi.MidiFile()),
  );
  gen.generate();
  expect(gen.tickLookup.masterBars.map((b) => b.masterBar.index)).toEqual([0, 1, 2, 0, 1]);
  await page.reload();
  await page.getByRole("button", { name: "校對辨識結果與原譜", exact: true }).click();
  await page.getByLabel("校對小節與聲部").selectOption("2");
  await expect(page.getByLabel("本小節結尾跳轉", { exact: true })).toHaveValue("8");
  await page.getByLabel("校對速度 BPM").fill("160");
  await page.getByLabel("確認調弦與 Capo", { exact: true }).check();
  for (const b of ["0", "1", "2"]) {
    await page.getByLabel("校對小節與聲部").selectOption(b);
    await page.getByLabel("確認六線譜節奏", { exact: true }).check();
    await page.getByLabel("確認本小節音符與節奏", { exact: true }).check();
  }
  await page.getByRole("button", { name: "確認全部，合成播放", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  const count = page.getByRole("button", { name: "預備拍", exact: true });
  if ((await count.getAttribute("aria-pressed")) === "true") await count.click();
  await page.evaluate(() => {
    (window as any).__dcBars = [];
    const end = performance.now() + 12000;
    const frame = () => {
      const b = Number(
        document.querySelector('[data-testid="bar-label"]')?.textContent?.match(/第\s*(\d+)/)?.[1],
      );
      const order = (window as any).__dcBars;
      if (b && order.at(-1) !== b) order.push(b);
      if (performance.now() < end) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__dcBars.slice(0, 5)), { timeout: 12000 })
    .toEqual([1, 2, 3, 1, 2]);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
});
