import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("tests/fixtures/alignment", { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:5189/");
  const images = await page.evaluate(() =>
    [
      [0, 3, 7, 2],
      [5, 1, 8, 6],
    ].map((frets) => {
      const c = document.createElement("canvas");
      c.width = 1000;
      c.height = 650;
      const x = c.getContext("2d");
      x.fillStyle = "white";
      x.fillRect(0, 0, 1000, 650);
      x.fillStyle = "black";
      for (let i = 0; i < 6; i++) x.fillRect(100, 200 + i * 40, 802, 2);
      for (const n of [100, 900]) x.fillRect(n, 200, 2, 202);
      frets.forEach((f, i) => {
        const p = 200 + i * 200;
        x.fillStyle = "white";
        x.fillRect(p - 18, 178, 36, 42);
        x.fillStyle = "black";
        x.font = "32px Arial";
        x.textAlign = "center";
        x.fillText(String(f), p, 211);
        x.fillRect(p + 12, 425, 2, 75);
      });
      return c.toDataURL();
    }),
  );
  await page.setContent(
    `<style>@page{size:1000px 650px;margin:0}body{margin:0}.page{width:1000px;height:650px;break-after:page}img{width:100%}</style>${images.map((src) => `<section class="page"><img src="${src}"></section>`).join("")}`,
  );
  await page.locator("img").evaluateAll((images) => Promise.all(images.map((i) => i.decode())));
  await page.pdf({ path: "tests/fixtures/alignment/two-page-study.pdf", preferCSSPageSize: true });
} catch (e) {
  throw e;
} finally {
  await browser.close();
}
const pitches = [64, 67, 71, 66, 69, 65, 72, 70],
  times = [0.8, 1.25, 1.95, 2.55, 3, 3.85, 4.6, 5.2, 5.8],
  rate = 22050,
  duration = 7;
function wav(keys) {
  const buffer = Buffer.alloc(44 + rate * duration * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  keys.forEach((pitch, k) => {
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    for (let i = Math.ceil(times[k] * rate); i < Math.floor(times[k + 1] * rate); i++) {
      const t = i / rate - times[k],
        remaining = times[k + 1] - i / rate,
        envelope = Math.min(1, t / 0.008, remaining / 0.015) * (0.65 + 0.35 * Math.exp(-t * 3));
      const sample =
        envelope *
        (0.26 * Math.sin(2 * Math.PI * frequency * t) +
          0.1 * Math.sin(4 * Math.PI * frequency * t) +
          0.035 * Math.sin(6 * Math.PI * frequency * t));
      buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
    }
  });
  return buffer;
}
await writeFile("tests/fixtures/alignment/uneven-performance.wav", wav(pitches));
await writeFile("tests/fixtures/alignment/unrelated.wav", wav(Array(8).fill(40)));
console.log(
  "Created actual 2-page PDF and nonuniform harmonic PCM performance; boundaries .8, 3, 5.8 seconds.",
);
