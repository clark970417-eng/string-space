import { createCanvas } from "@napi-rs/canvas";
import { writeFile } from "node:fs/promises";
const c = createCanvas(1800, 650),
  x = c.getContext("2d");
x.fillStyle = "white";
x.fillRect(0, 0, c.width, c.height);
x.fillStyle = "#111";
x.font = "30px Arial";
x.fillText("Original TAB recognition study", 100, 80);
x.strokeStyle = "#111";
x.lineWidth = 2;
for (let i = 0; i < 6; i++) {
  x.beginPath();
  x.moveTo(100, 200 + i * 40);
  x.lineTo(1650, 200 + i * 40);
  x.stroke();
}
for (const a of [100, 1650]) {
  x.beginPath();
  x.moveTo(a, 200);
  x.lineTo(a, 400);
  x.stroke();
}
const notes = [
  { x: 300, s: 1, f: 0 },
  { x: 650, s: 2, f: 3 },
  { x: 1000, s: 3, f: 12 },
  { x: 1350, s: 6, f: 10 },
];
for (const n of notes) {
  const y = 200 + (n.s - 1) * 40;
  x.font = "32px Arial";
  x.textAlign = "center";
  const w = x.measureText(String(n.f)).width;
  x.fillStyle = "white";
  x.fillRect(n.x - w / 2 - 5, y - 22, w + 10, 40);
  x.fillStyle = "#111";
  x.fillText(String(n.f), n.x, y + 11);
  x.beginPath();
  x.moveTo(n.x + 15, 425);
  x.lineTo(n.x + 15, 500);
  x.stroke();
}
await writeFile("tests/fixtures/tab/printed-tab.png", c.toBuffer("image/png"));
await writeFile("tests/fixtures/tab/printed-tab.jpg", c.toBuffer("image/jpeg"));
x.fillStyle = "#111";
x.fillRect(1015, 490, 350, 7);
await writeFile("tests/fixtures/tab/beamed-tab.png", c.toBuffer("image/png"));
x.fillStyle = "white";
x.fillRect(285, 218, 30, 40);
x.fillStyle = "#111";
x.font = "32px Arial";
x.fillText("1", 300, 251);
await writeFile("tests/fixtures/tab/chord-tab.png", c.toBuffer("image/png"));
x.fillStyle = "white";
x.fillRect(0, 0, c.width, c.height);
await writeFile("tests/fixtures/tab/blank.png", c.toBuffer("image/png"));
