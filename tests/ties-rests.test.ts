import { it, expect } from "vitest";
import { importer, model, midi, Settings } from "@coderline/alphatab";
import { blockRestCandidates, hasTieArc, boundaryTieDirections } from "../src/music/tab-rhythm";
import { changeScore, quarterBeats, reviewRows, rhythmIssue } from "../src/music/review";
import { tiePredecessor } from "../src/music/ties";
import type { Pixels, TabStaff } from "../src/music/tab-image";
const staff: TabStaff = {
  left: 20,
  right: 580,
  lines: [120, 150, 180, 210, 240, 270],
  gap: 30,
  bars: [20, 300, 580],
};
const paper = (): Pixels => ({ width: 600, height: 400, ink: new Uint8Array(240000) });
function line(p: Pixels, x: number, y: number, w: number, h = 1) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) p.ink[yy * p.width + xx] = 1;
}
it("distinguishes hanging whole and sitting half rests, rejecting a floating rectangle", () => {
  const p = paper();
  line(p, 70, 180, 55, 2);
  line(p, 85, 180, 25, 10);
  line(p, 370, 180, 55, 2);
  line(p, 385, 172, 25, 10);
  line(p, 480, 200, 25, 10);
  expect(blockRestCandidates(p, staff).map((r) => r.duration)).toEqual([2, 1]);
});
it("requires an actual arch, not straight beams or equal note positions, including crossing a barline", () => {
  const p = paper();
  expect(hasTieArc(p, staff, 150, 450, 1)).toBe(false);
  line(p, 165, 100, 270, 2);
  expect(hasTieArc(p, staff, 150, 450, 1)).toBe(false);
  p.ink.fill(0);
  const left = 150 + 30 * 0.45,
    right = 450 - 30 * 0.45;
  for (let x = Math.ceil(left); x <= right; x++) {
    const t = (x - left) / (right - left);
    line(p, x, Math.round(120 - 30 * 0.6 - 30 * 0.55 * 4 * t * (1 - t)), 1, 2);
  }
  expect(hasTieArc(p, staff, 150, 450, 1)).toBe(true);
  expect(hasTieArc(p, staff, 150, 450, 6)).toBe(false);
});
it("full bar rest follows 3/4 and 6/8; half rests retain two quarter beats", () => {
  const score = importer.ScoreLoader.loadAlphaTex("\\ts 3 4 r.1 | \\ts 6 8 r.1 | \\ts 4 4 r.2 r.2");
  expect(reviewRows(score).map((r) => rhythmIssue(r, false).actual)).toEqual([3, 3, 4]);
  expect(quarterBeats(score.tracks[0].staves[0].bars[2].voices[0].beats[0])).toBe(2);
});
function score(tex: string) {
  return importer.ScoreLoader.loadAlphaTex("\\tempo 60 \\instrument 25 . " + tex);
}
it("a three-note tie crossing a bar emits one NoteOn, while an untied chord note still plucks", () => {
  const s = score("(0.1 3.2).2 (0.1{t} 3.2).2 | 0.1{t}.2 r.2");
  const commands: { tick: number; length: number; key: number }[] = [];
  const handler = new midi.AlphaSynthMidiFileHandler(new midi.MidiFile());
  const original = handler.addNote.bind(handler);
  handler.addNote = (...args: Parameters<typeof handler.addNote>) => {
    commands.push({ tick: args[1], length: args[2], key: args[3] });
    original(...args);
  };
  const g = new midi.MidiFileGenerator(s, new Settings(), handler);
  g.generate();
  expect(commands.filter((n) => n.key === 64)).toHaveLength(1);
  expect(commands.find((n) => n.key === 64)?.length).toBe(5760);
  expect(commands.filter((n) => n.key === 62)).toHaveLength(2);
});
it("editing either end of a tie never silently restores its old pitch; rests and first notes cannot tie", () => {
  const s = score("0.1.2 0.1{t}.2 | 0.1{t}.2 r.2");
  const json = changeScore(model.JsonConverter.scoreToJson(s), (s) => {
    s.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0].fret = 3;
  });
  const edited = model.JsonConverter.jsonToScore(json),
    bars = edited.tracks[0].staves[0].bars;
  expect(bars[0].voices[0].beats[1].notes[0].fret).toBe(3);
  expect(bars[0].voices[0].beats[1].notes[0].isTieDestination).toBe(false);
  expect(bars[1].voices[0].beats[0].notes[0].isTieDestination).toBe(false);
  expect(tiePredecessor(bars[0].voices[0].beats[0].notes[0])).toBeUndefined();
  const rest = score("0.1.4 r.4 0.1.2");
  expect(
    tiePredecessor(rest.tracks[0].staves[0].bars[0].voices[0].beats[2].notes[0]),
  ).toBeUndefined();
});

it("does not join a tie across a missing beat or an intervening rest after editing", () => {
  const original = score("0.1.2 0.1.2 | 0.1.1");
  const json = changeScore(model.JsonConverter.scoreToJson(original), (s) => {
    s.tracks[0].staves[0].bars[0].voices[0].beats[1].duration = model.Duration.Quarter;
    s.tracks[0].staves[0].bars[1].voices[0].beats[0].notes[0].isTieDestination = true;
  });
  expect(
    model.JsonConverter.jsonToScore(json).tracks[0].staves[0].bars[1].voices[0].beats[0].notes[0]
      .isTieDestination,
  ).toBe(false);
  const rest = score("0.1.4 r.4 0.1.2");
  const repaired = changeScore(model.JsonConverter.scoreToJson(rest), (s) => {
    s.tracks[0].staves[0].bars[0].voices[0].beats[2].notes[0].isTieDestination = true;
  });
  expect(
    model.JsonConverter.jsonToScore(repaired).tracks[0].staves[0].bars[0].voices[0].beats[2]
      .notes[0].isTieDestination,
  ).toBe(false);
});
it("does not mistake the rectangular foot of a time-signature digit for a half rest", () => {
  const p = paper();
  line(p, 60, 180, 100, 2);
  line(p, 85, 173, 25, 9);
  line(p, 95, 150, 4, 24);
  expect(blockRestCandidates(p, staff)).toHaveLength(0);
});

it("deleting a tie origin never silently connects its destination to another equal-pitch note", () => {
  const original = score("0.1.4 0.1.4 0.1{t}.4 3.1.4");
  const changed = changeScore(model.JsonConverter.scoreToJson(original), (s) =>
    s.tracks[0].staves[0].bars[0].voices[0].beats.splice(1, 1),
  );
  const note =
    model.JsonConverter.jsonToScore(changed).tracks[0].staves[0].bars[0].voices[0].beats[1]
      .notes[0];
  expect(note.isTieDestination).toBe(false);
  expect(note.fret).toBe(0);
});

it("requires curved system-edge evidence, rejecting missing, straight and wrong-direction halves", () => {
  const draw = (side: "in" | "out", direction: number) => {
    const p = paper(),
      x = side === "out" ? 480 : 120;
    const start = x + (side === "out" ? 1 : -1) * 13.5;
    const end = side === "out" ? 576 : 24;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      const xx = Math.round(start + (end - start) * t);
      const yy = Math.round(120 + direction * (18 + 16.5 * (2 * t - t * t)));
      line(p, xx, yy, 1, 2);
    }
    return { p, x };
  };
  for (const side of ["in", "out"] as const) {
    const { p, x } = draw(side, -1);
    expect(boundaryTieDirections(p, staff, x, 1, side)).toEqual([-1]);
    expect(boundaryTieDirections(p, staff, x, 2, side)).toEqual([]);
    expect(boundaryTieDirections(paper(), staff, x, 1, side)).toEqual([]);
    const flat = paper();
    line(flat, 20, 102, 560, 2);
    expect(boundaryTieDirections(flat, staff, x, 1, side)).toEqual([]);
    const reversed = draw(side, 1);
    expect(boundaryTieDirections(reversed.p, staff, x, 1, side)).toEqual([1]);
  }
});
