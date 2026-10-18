import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { importer, model, midi, Settings } from "@coderline/alphatab";
import { parseMusicXml } from "../src/music/importer";
import { buildTimeline, interpolate, validateAnchors, loopTicks } from "../src/music/timeline";
import { createDemo } from "../src/music/demo";
import { createAccompaniment } from "../src/music/accompaniment";
function parse(name: string) {
  return parseMusicXml(new Uint8Array(readFileSync(`tests/fixtures/${name}`)), name);
}
function timeline(score: model.Score) {
  const f = new midi.MidiFile();
  const g = new midi.MidiFileGenerator(
    score,
    new Settings(),
    new midi.AlphaSynthMidiFileHandler(f),
  );
  g.generate();
  return buildTimeline(g.tickLookup);
}
describe("real MusicXML import and original score", () => {
  it("plays an original 16-bar study with correct durations and guitar notes", () => {
    const p = createDemo();
    const s = model.JsonConverter.jsonToScore(p.scoreJson!);
    expect(s.masterBars).toHaveLength(16);
    expect(timeline(s).at(-1)!.endMs).toBe(48000);
    expect(s.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].realValue).toBe(64);
  });
  for (const file of ["known.musicxml", "known.mxl"])
    it(`parses real title, notes, rest, time signature and tabs in ${file}`, () => {
      const { score, suggested } = parse(file);
      expect(score.title.replace(/\s/g, " ")).toBe("真實匯入測試 · 四小節");
      expect(score.masterBars).toHaveLength(4);
      expect(score.tempo).toBe(120);
      const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
      expect(beats.map((b) => b.notes[0]?.realValue ?? null)).toEqual([64, 67, null, 59]);
      expect(beats[2].isRest).toBe(true);
      expect(beats[1].notes[0].fret).toBe(3);
      expect(suggested).toBe(false);
      expect(timeline(score).at(-1)!.endMs).toBe(8000);
    });
  it("labels generated fingering while preserving every pitch", () => {
    const a = parse("known.musicxml"),
      b = parse("pitch-only.xml");
    const notes = (s: model.Score) =>
      s.tracks[0].staves[0].bars.flatMap((b) =>
        b.voices[0].beats.flatMap((b) => b.notes.map((n) => n.realValue)),
      );
    expect(b.suggested).toBe(true);
    expect(notes(a.score)).toEqual(notes(b.score));
  });
  it("expands original repeats into a real playback sequence", () => {
    const bars = timeline(parse("repeats.musicxml").score);
    expect(bars.map((b) => b.index)).toEqual([0, 1, 0, 1, 2, 3]);
    expect(bars.at(-1)!.endMs).toBe(12000);
    expect(loopTicks(bars, 1, 2)).toEqual({ startTick: 0, endTick: 7680 });
  });
  it("preserves tempo changes rather than deriving a fixed scrolling speed", () => {
    const bars = timeline(parse("tempo-change.musicxml").score);
    expect(bars.map((b) => b.endMs - b.startMs)).toEqual([2000, 2000, 4000, 4000]);
  });
  it("rejects unsupported XML and corrupt/empty data", () => {
    for (const text of [
      "garbage",
      "<score-timewise/>",
      "<score-partwise/>",
      "<score-partwise><foo></score-partwise>",
    ])
      expect(() => parseMusicXml(new TextEncoder().encode(text), "bad.xml")).toThrow();
  });
});
describe("practice timing and accompaniment", () => {
  it("creates actual chord notes with user-specified beats", () => {
    const p = createAccompaniment(
      "test",
      [
        { chord: "Am", beats: 3 },
        { chord: "G", beats: 4 },
      ],
      60,
      "arp",
    );
    const s = model.JsonConverter.jsonToScore(p.scoreJson!);
    expect(p.kind).toBe("chords");
    expect(s.masterBars[0].timeSignatureNumerator).toBe(3);
    expect(timeline(s).at(-1)!.endMs).toBe(7000);
    expect(s.tracks[0].staves[0].bars[0].voices[0].beats).toHaveLength(6);
  });
  it("validates manual audio anchors and maps both directions", () => {
    const bars = timeline(parse("known.musicxml").score);
    expect(validateAnchors([1, 3, 5, 7, 9], bars, 12)).toBe("");
    expect(validateAnchors([1, 3, 2, 7, 9], bars, 12)).not.toBe("");
    expect(validateAnchors([1, 3], bars, 12)).not.toBe("");
    const ticks = [0, 3840, 7680, 11520, 15360];
    expect(interpolate(4, [1, 3, 5, 7, 9], ticks)).toBe(5760);
    expect(interpolate(5760, ticks, [1, 3, 5, 7, 9])).toBe(4);
  });
  it("rejects invalid chord, loop and tempo settings", () => {
    expect(() => createAccompaniment("", [{ chord: "X", beats: 4 }], 80, "block")).toThrow();
    expect(() => createAccompaniment("", [{ chord: "C", beats: 0 }], 80, "block")).toThrow();
    expect(() => loopTicks(timeline(parse("known.musicxml").score), 3, 1)).toThrow();
  });
});
