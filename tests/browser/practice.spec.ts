import { test, expect, type Page } from "@playwright/test";
const fixture = (name: string) => `tests/fixtures/${name}`;
async function ready(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled({
    timeout: 30000,
  });
}
async function importScore(page: Page, name = "known.musicxml") {
  await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
  await page.getByLabel("選擇樂譜檔案", { exact: true }).setInputFiles(fixture(name));
  await expect(page.getByText("已解析真實樂譜內容")).toBeVisible();
  await page.getByRole("button", { name: "確認並開始練習" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
}
async function snapshot(page: Page) {
  return page.evaluate(() => (window as any).__practice.state);
}
async function noCount(page: Page) {
  const b = page.getByRole("button", { name: "預備拍", exact: true });
  if ((await b.getAttribute("aria-pressed")) === "true") await b.click();
}
async function instrument(page: Page) {
  await page.addInitScript(() => {
    (window as any).__analysers = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination: any, ...rest: any[]) {
      if (destination instanceof AudioDestinationNode && !(this instanceof AnalyserNode)) {
        const a = this.context.createAnalyser();
        a.fftSize = 2048;
        (window as any).__analysers.push(a);
        connect.call(this, a);
        connect.call(a, destination);
        return destination;
      }
      return (connect as any).call(this, destination, ...rest);
    };
  });
}
async function rms(page: Page) {
  return page.evaluate(() => {
    return Math.max(
      0,
      ...(window as any).__analysers.map((a: AnalyserNode) => {
        const b = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(b);
        return Math.sqrt(b.reduce((sum, v) => sum + v * v, 0) / b.length);
      }),
    );
  });
}
test("first visit plays real guitar samples and pauses clock and cursor together", async ({
  page,
}) => {
  await instrument(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await expect(page.locator("[data-bar]")).toHaveCount(16);
  await noCount(page);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).tick).toBeGreaterThan(1000);
  await expect.poll(() => rms(page)).toBeGreaterThan(0.001);
  const s = await snapshot(page);
  expect(s.bar).toBe(Math.floor(s.tick / 3840));
  expect(s.playing).toBe(true);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await page.waitForTimeout(350);
  const paused = await snapshot(page);
  const cursor = await page.locator(".at-cursor-beat").getAttribute("style");
  await page.waitForTimeout(800);
  expect((await snapshot(page)).tick).toBe(paused.tick);
  expect(await page.locator(".at-cursor-beat").getAttribute("style")).toBe(cursor);
  expect(await rms(page)).toBeLessThan(0.001);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
});
test("MusicXML import reflects actual content, click seeking, speed and persistence", async ({
  page,
}) => {
  await ready(page);
  await importScore(page);
  await expect(page.locator("[data-bar]")).toHaveCount(4);
  await expect(page.locator("h1")).toHaveText(/真實匯入測試/);
  const notes = await page.evaluate(() =>
    (window as any).__practice.api.score.tracks[0].staves[0].bars[0].voices[0].beats.map(
      (b: any) => b.notes[0]?.realValue ?? null,
    ),
  );
  expect(notes).toEqual([64, 67, null, 59]);
  await page.getByRole("button", { name: "跳到第 3 小節", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).bar).toBe(2);
  expect((await snapshot(page)).tick).toBeGreaterThanOrEqual(7680);
  await page.getByLabel("播放速度", { exact: true }).selectOption("0.5");
  await noCount(page);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  const startTick = (await snapshot(page)).tick;
  await expect.poll(async () => (await snapshot(page)).tick).toBeGreaterThan(startTick + 100);
  const timedSnapshot = () =>
    page.evaluate(() => ({ ...(window as any).__practice.state, sampledAt: performance.now() }));
  const s1 = await timedSnapshot();
  await page.waitForTimeout(1200);
  const s2 = await timedSnapshot();
  const ticksPerSecond = ((s2.tick - s1.tick) * 1000) / (s2.sampledAt - s1.sampledAt);
  expect(ticksPerSecond).toBeGreaterThan(750);
  expect(ticksPerSecond).toBeLessThan(1170);
  expect(s2.tempo).toBe(60);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await page.waitForTimeout(1100);
  const savedBar = (await snapshot(page)).bar;
  await page.reload();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await expect(page.getByLabel("播放速度", { exact: true })).toHaveValue("0.5");
  await expect.poll(async () => (await snapshot(page)).bar).toBe(savedBar);
});
test("compressed MusicXML and pitch-only score are correctly distinguished", async ({ page }) => {
  await ready(page);
  await importScore(page, "known.mxl");
  await expect(page.locator("h1")).toHaveText(/真實匯入測試/);
  await importScore(page, "pitch-only.xml");
  await expect(page.locator(".level-tag")).toHaveText("系統建議指法");
  const pitches = await page.evaluate(() =>
    (window as any).__practice.api.score.tracks[0].staves[0].bars[0].voices[0].beats.flatMap(
      (b: any) => b.notes.map((n: any) => n.realValue),
    ),
  );
  expect(pitches).toEqual([64, 67, 59]);
});
test("A–B repeats without clock drift or growing note duplication", async ({ page }) => {
  await ready(page);
  await importScore(page);
  await noCount(page);
  await page.getByRole("button", { name: "A–B 循環", exact: true }).click();
  await page.getByLabel("循環起始小節").selectOption("1");
  await page.getByLabel("循環結束小節").selectOption("1");
  await page.getByRole("button", { name: "開始循環練習" }).click();
  await expect(page.locator(".measure-hit.in-loop")).toHaveCount(1);
  await page.evaluate(() => {
    const e = (window as any).__practice;
    (window as any).__positions = [];
    (window as any).__notes = [];
    e.api.midiEventsPlayedFilter = [128];
    e.api.midiEventsPlayed.on((p: any) => {
      (window as any).__notes.push(
        ...p.events
          .filter((n: any) => n.track === 0 && n.noteVelocity > 0)
          .map((n: any) => ({ key: n.noteKey, tick: n.tick, t: performance.now() })),
      );
    });
    e.api.playerPositionChanged.on((p: any) => {
      if (e.state.playing)
        (window as any).__positions.push({ tick: p.currentTick, t: performance.now() });
    });
  });
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForTimeout(10200);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  const times = await page.evaluate(() => {
    const p = (window as any).__positions;
    return p.filter((v: any, i: number) => i && v.tick < p[i - 1].tick - 1000).map((v: any) => v.t);
  });
  expect(times.length).toBeGreaterThanOrEqual(4);
  for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThan(1850);
  for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeLessThan(2150);
  expect((await snapshot(page)).bar).toBe(0);
  const notes = await page.evaluate(() => (window as any).__notes);
  expect(notes.every((n: any) => [64, 67, 59].includes(n.key))).toBe(true);
  // Check complete audible cycles, excluding a possible partial cycle during
  // audio-output startup and the final pause. Each cycle must contain exactly
  // the three source notes, in order, with no extra overlapping NoteOn events.
  const cycles: number[][] = [];
  for (const n of notes) {
    if (n.key === 64) cycles.push([]);
    cycles.at(-1)?.push(n.key);
  }
  expect(cycles.length).toBeGreaterThanOrEqual(4);
  for (const cycle of cycles.slice(1, -1)) expect(cycle).toEqual([64, 67, 59]);
  await page.getByRole("button", { name: "1–1 循環", exact: true }).click();
  await page.getByRole("button", { name: "關閉循環", exact: true }).click();
  await page.getByRole("button", { name: "跳到第 4 小節", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).bar).toBe(3);
});
test("long score follows near viewport edge and respects manual browsing", async ({ page }) => {
  await ready(page);
  await importScore(page, "long.musicxml");
  await noCount(page);
  await page.getByRole("button", { name: "跳到第 20 小節", exact: true }).click();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.mouse.wheel(0, -450);
  await expect(page.getByRole("button", { name: "回到目前播放位置" })).toBeVisible();
  await page.waitForTimeout(300);
  const y = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(2200);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThan(30);
  await page.getByRole("button", { name: "回到目前播放位置" }).click();
  await expect(page.getByRole("button", { name: "回到目前播放位置" })).toHaveCount(0);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
});
test("unsupported and broken files show actionable errors without replacing current score", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "上傳樂譜", exact: true }).first().click();
  const input = page.getByLabel("選擇樂譜檔案", { exact: true });
  await input.setInputFiles({
    name: "bad.gp5",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not music"),
  });
  await expect(page.getByRole("alert")).toContainText("Guitar Pro");
  await input.setInputFiles({
    name: "broken.musicxml",
    mimeType: "text/xml",
    buffer: Buffer.from("<score-partwise>"),
  });
  await expect(page.getByRole("alert")).toContainText("結構損壞");
  await input.setInputFiles({
    name: "broken.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toContainText("檔案內容與副檔名不一致");
  await input.setInputFiles({
    name: "truncated.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([255, 216, 255, 0, 0, 0]),
  });
  await expect(page.getByRole("alert")).toContainText("圖片無法讀取");
  await page.getByRole("button", { name: "關閉視窗" }).click();
  await expect(page.locator("h1")).toHaveText("午後，慢慢彈");
});
test("user recording is gated by explicit manual alignment and uses media clock", async ({
  page,
}) => {
  await ready(page);
  await importScore(page);
  await page.getByRole("button", { name: "配對音檔", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles(fixture("test-tone.wav"));
  await expect(page.getByRole("button", { name: "保存時間對齊" })).toBeDisabled();
  await expect(page.getByText("長度 12.00 秒")).toBeVisible();
  await page.locator("audio").evaluate(async (audio) => {
    (window as any).__previewAudio = audio;
    await audio.play();
  });
  for (let i = 0; i < 5; i++) await page.locator(`#anchor-${i}`).fill(String(i * 2 + 1));
  await page.getByLabel("我已聽過並校正這些時間點").check();
  await page.getByRole("button", { name: "保存時間對齊" }).click();
  expect(await page.evaluate(() => (window as any).__previewAudio.paused)).toBe(true);
  await page.getByLabel("播放模式", { exact: true }).selectOption("audio");
  await expect(page.getByRole("button", { name: "節拍器", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForTimeout(1200);
  const data = await page.evaluate(() => {
    const e = (window as any).__practice;
    return {
      state: e.state,
      current: e.audio.currentTime,
      synthState: e.api.playerState,
      pitch: e.audio.preservesPitch,
    };
  });
  expect(data.synthState).toBe(0);
  expect(data.pitch).toBe(true);
  expect(Math.abs(data.state.time / 1000 - data.current)).toBeLessThan(0.1);
  expect(Math.abs(data.state.tick - (data.current - 1) * 1920)).toBeLessThan(200);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await page.getByRole("button", { name: "跳到第 3 小節", exact: true }).click();
  expect((await snapshot(page)).time).toBeCloseTo(5000, -1);
  await page.getByLabel("播放速度", { exact: true }).selectOption("0.5");
  expect(await page.evaluate(() => (window as any).__practice.audio.playbackRate)).toBe(0.5);
});
test("chord accompaniment creates chosen notes and beats", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "建立和弦伴奏", exact: true }).click();
  await page.getByLabel("和弦 1 拍數", { exact: true }).fill("3");
  await page.getByRole("button", { name: "建立練習伴奏", exact: true }).click();
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await expect(page.locator("h1")).toHaveText("我的和弦練習");
  expect(
    await page.evaluate(
      () => (window as any).__practice.api.score.masterBars[0].timeSignatureNumerator,
    ),
  ).toBe(3);
  await expect(
    page.getByText("這是依和弦、拍數和伴奏型態產生的練習伴奏，不代表原曲旋律或編曲。"),
  ).toBeAttached();
});

test("recording loop continues when B is exactly the audio file end", async ({ page }) => {
  await ready(page);
  await importScore(page);
  await page.getByRole("button", { name: "配對音檔", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles(fixture("test-tone.wav"));
  await expect(page.getByText("長度 12.00 秒")).toBeVisible();
  for (let i = 0; i < 5; i++) await page.locator(`#anchor-${i}`).fill(String(i * 3));
  await page.getByLabel("我已聽過並校正這些時間點").check();
  await page.getByRole("button", { name: "保存時間對齊" }).click();
  await page.getByLabel("播放模式", { exact: true }).selectOption("audio");
  await page.getByLabel("播放速度", { exact: true }).selectOption("1.5");
  await page.getByRole("button", { name: "A–B 循環", exact: true }).click();
  await page.getByLabel("循環起始小節").selectOption("4");
  await page.getByLabel("循環結束小節").selectOption("4");
  await page.getByRole("button", { name: "開始循環練習" }).click();
  await page.evaluate(() => {
    (window as any).__mediaEnds = 0;
    (window as any).__loopReturns = 0;
    (window as any).__practice.audio.addEventListener("ended", () => (window as any).__mediaEnds++);
    (window as any).__practice.audio.addEventListener("seeked", () => {
      const time = (window as any).__practice.audio.currentTime;
      if (time >= 9 && time < 9.5) (window as any).__loopReturns++;
    });
  });
  await page.getByRole("button", { name: "播放", exact: true }).click();
  // One initial seek plus two returns. Startup time and whether an individual
  // wrap is handled by requestAnimationFrame or ended may vary by browser.
  await expect
    .poll(() => page.evaluate(() => (window as any).__loopReturns))
    .toBeGreaterThanOrEqual(3);
  await expect.poll(async () => (await snapshot(page)).playing).toBe(true);
  const s = await snapshot(page);
  expect(s.playing).toBe(true);
  expect(s.bar).toBe(3);
  expect(s.time).toBeGreaterThanOrEqual(9000);
  expect(s.time).toBeLessThan(12000);
  expect(await page.evaluate(() => (window as any).__mediaEnds)).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await page.waitForTimeout(300);
  const paused = await snapshot(page);
  await page.waitForTimeout(500);
  expect((await snapshot(page)).tick).toBe(paused.tick);
});

test("count-in, progress seeking, live speed changes and interruption use the same clock", async ({
  page,
}) => {
  await ready(page);
  await importScore(page);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(page.locator(".transport-status")).toHaveText("預備一小節…");
  await page.waitForTimeout(400);
  expect((await snapshot(page)).tick).toBeLessThan(100);
  await expect.poll(async () => (await snapshot(page)).tick).toBeGreaterThan(200);
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  const slider = page.getByRole("slider", { name: "播放進度", exact: true });
  const rect = (await slider.boundingBox())!;
  await page.mouse.click(rect.x + rect.width * 0.58, rect.y + rect.height / 2);
  await expect.poll(async () => (await snapshot(page)).bar).toBe(2);
  await page.getByRole("button", { name: "回到開頭" }).click();
  await expect.poll(async () => (await snapshot(page)).tick).toBeLessThan(10);
  await noCount(page);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).tick).toBeGreaterThan(100);
  await page.getByLabel("播放速度", { exact: true }).selectOption("0.5");
  await expect.poll(async () => (await snapshot(page)).tempo).toBe(60);
  const timedSnapshot = () =>
    page.evaluate(() => ({ ...(window as any).__practice.state, sampledAt: performance.now() }));
  const before = await timedSnapshot();
  await page.waitForTimeout(1000);
  const after = await timedSnapshot();
  const ticksPerSecond = ((after.tick - before.tick) * 1000) / (after.sampledAt - before.sampledAt);
  expect(ticksPerSecond).toBeGreaterThan(700);
  expect(ticksPerSecond).toBeLessThan(1200);
  expect(after.bar).toBe(Math.floor(after.tick / 3840));
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("已同步暫停");
  await page.waitForTimeout(300);
  const frozen = await snapshot(page);
  await page.waitForTimeout(500);
  expect((await snapshot(page)).tick).toBe(frozen.tick);
});
