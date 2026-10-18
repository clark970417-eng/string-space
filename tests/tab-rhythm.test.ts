import { expect, it } from "vitest";
import { importer, midi, Settings } from "@coderline/alphatab";
import {
  augmentationDots,
  applyTuplets,
  rhythmTex,
  shapeMask,
  type RhythmEvent,
  type Shape,
} from "../src/music/tab-rhythm";
import { buildTimeline } from "../src/music/timeline";
import type { Pixels, TabStaff } from "../src/music/tab-image";
const staff: TabStaff = {
  lines: [100, 120, 140, 160, 180, 200],
  gap: 20,
  left: 0,
  right: 500,
  bars: [0, 500],
};
function dot(x: number, y: number): Shape {
  return {
    x,
    y,
    w: 3,
    h: 3,
    points: Array.from({ length: 9 }, (_, i) => (y + Math.floor(i / 3)) * 500 + x + (i % 3)),
  };
}
it("accepts one/two horizontal augmentation dots; rejects repeat dots, barline dots and adjacent event marks", () => {
  expect(augmentationDots(staff, [dot(112, 99)], 100, [100], 200)).toBe(1);
  expect(augmentationDots(staff, [dot(112, 99), dot(119, 99)], 100, [100], 200)).toBe(2);
  expect(augmentationDots(staff, [dot(112, 96), dot(112, 102)], 100, [100], 200)).toBe(0);
  expect(augmentationDots(staff, [dot(490, 99)], 480, [100], 500)).toBe(0);
  expect(augmentationDots(staff, [dot(112, 99)], 100, [100], 115)).toBe(0);
});
it("never infers tuplets from equally spaced events without visible symbols", () => {
  const events: RhythmEvent[] = [100, 200, 300].map((x) => ({
    x,
    duration: 8,
    dots: 0,
    tuplet: 0,
    tex: "0.1",
    evidence: [],
  }));
  const p: Pixels = { width: 500, height: 300, ink: new Uint8Array(150000) };
  applyTuplets(p, staff, [], [], events, []);
  expect(events.map((e) => e.tuplet)).toEqual([0, 0, 0]);
});
it("recognized rests, dots and tuplets produce exact synth ticks and a shared 3-second bar timeline", () => {
  const event = (tex: string, duration: number, dots = 0, tuplet = 0): RhythmEvent => ({
    x: 0,
    tex,
    duration,
    dots,
    tuplet,
    evidence: [],
  });
  const bars = [
    [event("0.1", 4, 1), event("r", 8), event("r", 4), event("3.1", 4)],
    [event("0.1", 4, 2), event("r", 16), event("r", 4), event("3.1", 4)],
    [event("0.1", 4, 0, 3), event("r", 4, 0, 3), event("3.1", 4, 0, 3), event("r", 2)],
    [
      event("0.1", 8, 0, 5),
      event("r", 8, 0, 5),
      event("3.1", 8, 0, 5),
      event("5.1", 8, 0, 5),
      event("7.1", 8, 0, 5),
      event("r", 2),
    ],
  ];
  const score = importer.ScoreLoader.loadAlphaTex(
    "\\tempo 80 \\instrument 25 . " + bars.map((b) => b.map(rhythmTex).join(" ")).join(" | "),
  );
  const v = score.tracks[0].staves[0].bars.map((b) => b.voices[0]);
  expect(v.map((v) => v.beats.map((b) => b.playbackDuration))).toEqual([
    [1440, 480, 960, 960],
    [1680, 240, 960, 960],
    [640, 640, 640, 1920],
    [384, 384, 384, 384, 384, 1920],
  ]);
  expect(v[0].beats.map((b) => b.playbackStart)).toEqual([0, 1440, 1920, 2880]);
  expect(v[0].beats.filter((b) => b.isRest).flatMap((b) => b.notes)).toHaveLength(0);
  const f = new midi.MidiFile();
  const g = new midi.MidiFileGenerator(
    score,
    new Settings(),
    new midi.AlphaSynthMidiFileHandler(f),
  );
  g.generate();
  expect(buildTimeline(g.tickLookup).map((b) => b.endMs - b.startMs)).toEqual([
    3000, 3000, 3000, 3000,
  ]);
});

it("requires bracket hooks and a complete equal-duration group before assigning a tuplet", () => {
  const p: Pixels = { width: 500, height: 300, ink: new Uint8Array(150000) };
  const shape: Shape = { x: 240, y: 50, w: 10, h: 14, points: [] };
  for (let y = 50; y < 64; y++)
    for (let x = 240; x < 250; x++)
      if (x > 246 || y === 50 || y === 57 || y === 63) {
        p.ink[y * 500 + x] = 1;
        shape.points.push(y * 500 + x);
      }
  const templates = [
    { kind: "tuplet" as const, value: 3, ratio: 10 / 14, mask: shapeMask(shape, 500) },
  ];
  const events = () =>
    [200, 250, 300].map((x) => ({ x, duration: 8, dots: 0, tuplet: 0, tex: "0.1", evidence: [] }));
  for (let x = 200; x <= 232; x++) p.ink[57 * 500 + x] = 1;
  for (let x = 258; x <= 300; x++) p.ink[57 * 500 + x] = 1;
  let e = events();
  applyTuplets(p, staff, [shape], templates, e, []);
  expect(e.every((v) => !v.tuplet)).toBe(true);
  for (let y = 57; y <= 64; y++) {
    p.ink[y * 500 + 200] = 1;
    p.ink[y * 500 + 300] = 1;
  }
  e = events().slice(0, 2);
  applyTuplets(p, staff, [shape], templates, e, []);
  expect(e.every((v) => !v.tuplet)).toBe(true);
  e = events();
  e[1].duration = 16;
  applyTuplets(p, staff, [shape], templates, e, []);
  expect(e.every((v) => !v.tuplet)).toBe(true);
  e = events();
  applyTuplets(p, staff, [shape], templates, e, []);
  expect(e.map((v) => v.tuplet)).toEqual([3, 3, 3]);
});
