import { expect, it } from "vitest";
import { staffGroups, digitRegions, rhythmCandidate, type Pixels } from "../src/music/tab-image";
import { parsePages } from "../src/music/tab-recognition";
function paper(): Pixels {
  return { width: 1000, height: 400, ink: new Uint8Array(400000) };
}
function line(p: Pixels, x: number, y: number, x2: number, y2: number) {
  for (let yy = y; yy <= y2; yy++) for (let xx = x; xx <= x2; xx++) p.ink[yy * p.width + xx] = 1;
}
it("detects six strings and bar boundaries; rejects five lines", () => {
  const p = paper();
  for (let i = 0; i < 6; i++) line(p, 50, 100 + i * 20, 950, 100 + i * 20);
  for (const x of [50, 500, 950]) line(p, x, 100, x, 200);
  const s = staffGroups(p);
  expect(s).toHaveLength(1);
  expect(s[0].bars).toEqual([50, 500, 950]);
  line(p, 170, 92, 174, 108);
  line(p, 179, 92, 185, 108);
  expect(digitRegions(p, s[0]).filter((g) => g.string === 1)).toHaveLength(1);
  p.ink.fill(0, 200000, 201000);
  expect(staffGroups(p)).toHaveLength(0);
});
it("uses visible stems and beams, never horizontal note spacing, for duration candidates", () => {
  const p = paper();
  for (let i = 0; i < 6; i++) line(p, 50, 100 + i * 20, 950, 100 + i * 20);
  const s = staffGroups(p)[0];
  expect(rhythmCandidate(p, s, 200).evidence).toContain("暫填");
  line(p, 200, 201, 201, 250);
  expect(rhythmCandidate(p, s, 200).duration).toBe(4);
  line(p, 200, 245, 230, 248);
  expect(rhythmCandidate(p, s, 200).duration).toBe(8);
  line(p, 200, 235, 230, 238);
  expect(rhythmCandidate(p, s, 200).duration).toBe(16);
});
it("validates and orders selected PDF pages", () => {
  expect(parsePages("3,1-2", 4)).toEqual([1, 2, 3]);
  expect(() => parsePages("1-9", 12)).toThrow();
  expect(() => parsePages("0", 2)).toThrow();
  expect(() => parsePages("3", 2)).toThrow();
});
