import { it, expect } from "vitest";
import { importer, model, midi, Settings } from "@coderline/alphatab";
import { repeatIssue, repeatOrder } from "../src/music/repeats";
import { changeScore } from "../src/music/review";
import { repeatSigns, endingBrackets } from "../src/music/tab-repeats";
import { rhythmShapes } from "../src/music/tab-rhythm";
const parse = (tex: string) => importer.ScoreLoader.loadAlphaTex("\\tempo 120 . " + tex);
it("uses native repeat expansion for flat repeats and first/second endings", () => {
  const s = parse("\\ro 0.1.1 | \\ae 1 \\rc 2 0.1.1 | \\ae 2 0.1.1");
  expect(repeatIssue(s)).toBe("");
  expect(repeatOrder(s)).toEqual([1, 2, 1, 3]);
  s.masterBars[1].repeatCount = 3;
  expect(repeatIssue(s)).toContain("兩遍");
  s.masterBars[1].repeatCount = 0;
  expect(repeatIssue(s)).toBeTruthy();
  expect(repeatOrder(parse("0.1.1 | \\rc 3 0.1.1"))).toEqual([1, 2, 1, 2, 1, 2]);
});
it("rearticulates at repeat branches, while internal ties sustain on each pass", () => {
  const raw = parse("0.1.1 | \\ro 0.1{t}.2 0.1{t}.2 | \\rc 2 0.1.1");
  const s = model.JsonConverter.jsonToScore(
    changeScore(model.JsonConverter.scoreToJson(raw), () => {}),
  );
  const notes = s.tracks[0].staves[0].bars[1].voices[0].beats.map((b) => b.notes[0]);
  expect(notes[0].isTieDestination).toBe(false);
  expect(notes[1].isTieDestination).toBe(true);
  const calls: { tick: number; len: number }[] = [];
  const h = new midi.AlphaSynthMidiFileHandler(new midi.MidiFile());
  const add = h.addNote.bind(h);
  h.addNote = (...a) => {
    calls.push({ tick: a[1], len: a[2] });
    add(...a);
  };
  new midi.MidiFileGenerator(s, new Settings(), h).generate();
  expect(calls.map((c) => c.tick)).toEqual([0, 3840, 7680, 11520, 15360]);
  expect(calls[1].len).toBe(3840);
  expect(calls[3].len).toBe(3840);
});
it("requires double bars and paired dots; brackets need a hook and bar-aligned range", () => {
  const p = { width: 800, height: 500, ink: new Uint8Array(400000) };
  const s = {
    left: 50,
    right: 750,
    lines: [160, 200, 240, 280, 320, 360],
    gap: 40,
    bars: [50, 400, 750],
  };
  const rect = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) p.ink[yy * 800 + xx] = 1;
  };
  rect(400, 160, 2, 201);
  rect(410, 160, 3, 201);
  rect(375, 236, 8, 8);
  rect(375, 276, 8, 8);
  expect(repeatSigns(p, s, rhythmShapes(p, s))[1]).toEqual({ start: false, end: true });
  rect(400, 80, 351, 2);
  rect(400, 80, 2, 20);
  expect(endingBrackets(p, s)).toHaveLength(1);
  p.ink.fill(0);
  rect(400, 160, 2, 201);
  rect(375, 236, 8, 8);
  rect(375, 276, 8, 8);
  expect(repeatSigns(p, s, rhythmShapes(p, s))[1].end).toBe(false);
});
it("validates missing endings and nested repeats rather than silently choosing a sequence", () => {
  const s = parse("\\ro 0.1.1 | \\ae 1 \\rc 2 0.1.1 | 0.1.1");
  expect(repeatIssue(s)).toContain("需要二房");
  s.masterBars[1].isRepeatStart = true;
  expect(repeatIssue(s)).toContain("巢狀");
  const range = parse(
    "\\ro 0.1.1 | \\ae 1 0.1.1 | \\ae 1 \\rc 2 0.1.1 | \\ae 2 0.1.1 | \\ae 2 0.1.1",
  );
  expect(repeatOrder(range)).toEqual([1, 2, 3, 1, 4, 5]);
});
it("does not OCR the second stroke of an internal repeat bar as fret 1", async () => {
  const { digitRegions } = await import("../src/music/tab-image");
  const p = { width: 800, height: 500, ink: new Uint8Array(400000) };
  const s = {
    left: 50,
    right: 750,
    lines: [160, 200, 240, 280, 320, 360],
    gap: 40,
    bars: [50, 400, 750],
  };
  for (let y = 160; y <= 360; y++)
    for (const x of [400, 401, 410, 411, 412, 413]) p.ink[y * 800 + x] = 1;
  expect(digitRegions(p, s)).toHaveLength(0);
});
it("expands two-level nested repeats and rejects deeper or unfinished nesting", () => {
  const s = parse("\\ro 0.1.1 | \\ro 0.1.1 | \\rc 2 0.1.1 | \\rc 2 0.1.1");
  const restored = model.JsonConverter.jsonToScore(
    changeScore(model.JsonConverter.scoreToJson(s), () => {}),
  );
  expect(repeatIssue(restored)).toBe("");
  expect(repeatOrder(restored)).toEqual([1, 2, 3, 2, 3, 4, 1, 2, 3, 2, 3, 4]);
  restored.masterBars[3].repeatCount = 0;
  expect(repeatIssue(restored)).toContain("閉合");
  restored.masterBars[2].isRepeatStart = true;
  expect(repeatIssue(restored)).toContain("兩層");
});
it("validates and expands DC/DS al Fine with native MIDI after saved JSON roundtrip", () => {
  for (const [tex, order] of [
    ["0.1.1 | \\jump Fine 0.1.1 | \\jump DaCapoAlFine 0.1.1", [1, 2, 3, 1, 2]],
    [
      "0.1.1 | \\jump Segno 0.1.1 | \\jump Fine 0.1.1 | \\jump DalSegnoAlFine 0.1.1",
      [1, 2, 3, 4, 2, 3],
    ],
    ["0.1.1 | \\jump DaCapo 0.1.1", [1, 2, 1, 2]],
    ["0.1.1 | \\jump Segno 0.1.1 | \\jump DalSegno 0.1.1", [1, 2, 3, 2, 3]],
  ] as const) {
    const s = model.JsonConverter.jsonToScore(
      changeScore(model.JsonConverter.scoreToJson(parse(tex)), () => {}),
    );
    expect(repeatIssue(s)).toBe("");
    expect(repeatOrder(s)).toEqual(order);
  }
  expect(repeatIssue(parse("0.1.1 | \\jump DalSegno 0.1.1"))).toContain("Segno");
  expect(repeatIssue(parse("0.1.1 | \\jump DaCapoAlFine 0.1.1"))).toContain("Fine");
  expect(repeatIssue(parse("\\ro 0.1.1 | \\rc 2 \\jump DaCapo 0.1.1"))).toContain("混用");
});
it("DC return attacks the source again but not its internal tied destination", () => {
  const s = model.JsonConverter.jsonToScore(
    changeScore(
      model.JsonConverter.scoreToJson(
        parse("0.1.2 0.1{t}.2 | \\jump Fine 0.1.1 | \\jump DaCapoAlFine 0.1.1"),
      ),
      () => {},
    ),
  );
  const attacks: { tick: number; len: number }[] = [];
  const h = new midi.AlphaSynthMidiFileHandler(new midi.MidiFile()),
    add = h.addNote.bind(h);
  h.addNote = (...a) => {
    attacks.push({ tick: a[1], len: a[2] });
    add(...a);
  };
  new midi.MidiFileGenerator(s, new Settings(), h).generate();
  expect(attacks.map((a) => a.tick)).toEqual([0, 3840, 7680, 11520, 15360]);
  expect(attacks[0].len).toBe(3840);
  expect(attacks[3].len).toBe(3840);
});
